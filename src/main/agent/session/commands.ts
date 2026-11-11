// 会话命令：新建、分支、归档、删除、换模型与 /compact、/reload、/name。
import { existsSync } from 'node:fs';
import type { ChatScope, MainSessionCommand, WorkspaceChat } from '../../../shared/api';
import { hostPorts } from '../../host';
import * as changes from '../changes';
import { forkSessionFile, loadPi, resolveModel } from '../pi';
import { usableLlmProviders } from '../providers';
import { closeSidechat } from '../sidechat';
import { stopSessionTasks } from '../tasks';
import { live, type Live } from './live';
import { publish, snapshot } from './projection';
import { disposeLive, ensureLive } from './run';
import {
  adoptSessionFile,
  archiveProject,
  childSessionIds,
  emptySessionId,
  insertSession,
  modelChoice,
  removeSession,
  row,
  sessionCwd,
  storeModel,
  storeTitle,
  storeVisibility,
} from './store';

/** 每个项目只保留一个空会话入口；正在运行的空会话不复用。 */
export function newSession(projectId: string | null, scope: ChatScope): WorkspaceChat {
  if (projectId !== null) sessionCwd(projectId, null);
  const empty = emptySessionId(projectId, scope);
  if (empty && !live.get(empty)?.run) return snapshot(empty);
  return snapshot(insertSession(projectId, scope));
}

/**
 * 从一条已完成回复分出新会话：同项目、同模型、同工作目录（历史里引用的文件都在那里），标题加「分支：」。
 * 分支前的每轮改动记录按会话 id 保存，不随分支复制。
 */
export async function forkSession(id: string, entryId: string): Promise<WorkspaceChat> {
  const meta = row(id);
  if (!meta.file || !existsSync(meta.file)) throw new Error('会话还没有可分支的记录');
  const file = await forkSessionFile(meta.file, sessionCwd(meta.project_id, meta.cwd), entryId);
  return snapshot(adoptSessionFile(meta, file, '分支：'));
}

export async function sessionExportBranch(id: string) {
  const { file } = row(id);
  if (!file || !existsSync(file)) throw new Error('这个会话还没有可导出的记录');
  const pi = await loadPi();
  const entry = live.get(id);
  if (entry?.run || entry?.session.isCompacting) throw new Error('请等待当前回答或压缩完成');
  return (entry?.session.sessionManager ?? pi.SessionManager.open(file)).getBranch();
}

export function openSession(id: string): WorkspaceChat {
  row(id);
  return snapshot(id);
}

export function updateSessionVisibility(
  id: string,
  patch: { archived?: boolean; pinned?: boolean },
) {
  row(id);
  if (patch.archived) {
    stopSessionTasks(id);
    void closeSidechat(id);
  }
  storeVisibility(id, patch);
}

export function archiveProjectSessions(projectId: string | null): string[] {
  const ids = archiveProject(projectId);
  for (const id of ids) {
    stopSessionTasks(id);
    void closeSidechat(id);
  }
  return ids;
}

export async function deleteSession(id: string) {
  await closeSidechat(id);
  stopSessionTasks(id);
  const entry = live.get(id);
  if (entry) {
    const done = entry.run?.done;
    if (entry.run) entry.run.cancelled = true;
    await entry.session.abort();
    await done;
    disposeLive(id, entry);
  }
  for (const child of childSessionIds(id)) await deleteSession(child);
  const { file } = row(id);
  removeSession(id);
  await changes.deleteTurnChanges(id);
  if (file && existsSync(file)) await hostPorts().desktop.trash(file);
}

/** Pi 压缩失败时抛英文原文：常见的两种换成能看懂的说明，其余带上原文。 */
function compactionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Nothing to compact/i.test(message)) return '对话还太短，没有可压缩的内容';
  if (/Already compacted/i.test(message)) return '刚压缩过，还没有新的内容可压缩';
  return `压缩失败：${message}`;
}

/**
 * 会话命令（/compact、/reload、/name），对应 Pi 终端界面里的同名命令。它们不是一轮对话：不写用户消息、
 * 不改自动标题、不记本轮文件变化，所以不走 askSession。执行完推一次快照，界面按快照更新。
 */
export async function runSessionCommand(
  id: string,
  name: MainSessionCommand,
  args: string,
): Promise<WorkspaceChat> {
  row(id);
  const busy = (entry: Live | undefined) => {
    if (entry?.run) throw new Error('请等待当前回答完成');
    if (entry?.session.isCompacting) throw new Error('正在压缩上下文，请稍候');
  };
  if (name === 'name') {
    const title = args.trim();
    if (!title) throw new Error('用法：/name 新标题');
    storeTitle(id, title);
  } else if (name === 'reload') {
    const entry = live.get(id);
    busy(entry);
    if (entry) disposeLive(id, entry);
    // 立刻重建：Skill、MCP 或远端连接的错误现在就报出来，不等下一次发送。
    if (modelChoice(row(id)).kind === 'ready') await ensureLive(id);
  } else {
    const entry = await ensureLive(id);
    busy(entry);
    try {
      await entry.session.compact(args || undefined);
    } catch (error) {
      // 用户在压缩中点了停止（cancelRun → abort）：不算失败。
      if (!/Compaction cancelled/i.test(error instanceof Error ? error.message : '')) {
        throw new Error(compactionError(error));
      }
    } finally {
      // 压缩期间配置变了：invalidateSessions 只标了 stale，这里补上丢弃。
      if (entry.stale) disposeLive(id, entry);
    }
  }
  publish(id);
  return snapshot(id);
}

/**
 * 只改这个会话的模型。空闲的实例就地切换（Pi 的 setModel 只改本会话并写进会话文件）；
 * 运行或压缩中的实例标 stale，本轮照旧用原模型，结束后按新选择重建。
 */
export async function setSessionModel(
  id: string,
  providerId: string,
  model: string,
): Promise<WorkspaceChat> {
  row(id);
  const provider = usableLlmProviders().find((item) => item.id === providerId);
  if (!provider) throw new Error('提供商不存在、已停用或缺少 API Key');
  if (!provider.models.includes(model)) throw new Error('模型不在该提供商的模型列表中');
  storeModel(id, providerId, model, null);
  await applySelection(id);
  publish(id);
  return snapshot(id);
}

export async function setSessionEffort(id: string, level: string): Promise<WorkspaceChat> {
  const choice = modelChoice(row(id));
  if (choice.kind !== 'ready') throw new Error('请先为这个会话选择可用的模型');
  if (!choice.effortLevels.includes(level))
    throw new Error('该档位不在这个模型开启的推理强度列表中，请先在设置中勾选');
  const { provider, model } = choice.selection;
  storeModel(id, provider.id, model, level);
  await applySelection(id);
  publish(id);
  return snapshot(id);
}

async function applySelection(id: string) {
  const entry = live.get(id);
  if (!entry) return;
  if (entry.run || entry.session.isCompacting) {
    entry.stale = true;
    return;
  }
  const choice = modelChoice(row(id));
  if (choice.kind !== 'ready') return;
  const { model, thinking } = await resolveModel(choice.selection);
  await entry.session.setModel(model);
  entry.session.setThinkingLevel(thinking);
  entry.providerId = choice.selection.provider.id;
}
