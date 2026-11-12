// 会话存储：SQLite 只存索引（项目归属、cwd、标题、置顶、归档、模型选择与 JSONL 路径），
// 完整记录是 Pi 的会话文件。cwd 解析失败直接报错，不静默换目录。
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatScope, ChatSessionSummary } from '../../../shared/api';
import { llmModelSettings } from '../../../shared/llm-models';
import type { StoredLlmProvider } from '../../credentials';
import { hostPorts } from '../../host';
import { sessionScope, sessionScopes, type SessionScope } from '../../../core/agent/scopes';
import { llmProviders, usableLlmProviders } from '../providers';
import type { SessionModel } from '../pi';

export interface SessionRow {
  id: string;
  project_id: string | null;
  cwd: string | null;
  file: string;
  title: string;
  provider_id: string | null;
  model: string | null;
  effort: string | null;
  /** 子 Agent 会话的父会话；顶层会话为 null。 */
  parent_id: string | null;
}

export function row(id: string): SessionRow {
  const found = hostPorts()
    .database()
    .prepare(
      'SELECT id, project_id, cwd, file, title, provider_id, model, effort, parent_id FROM sessions WHERE id=?',
    )
    .get(id) as SessionRow | undefined;
  if (!found) throw new Error('会话不存在');
  return found;
}

/** 不属于任何项目的通用会话以工作区根为默认目录。 */
function workspaceRoot() {
  const root = join(hostPorts().paths.storage(), 'workspace');
  mkdirSync(root, { recursive: true });
  return root;
}

/** 通用会话的私有工作目录：与 workspace 平级的 chat-sessions/<会话 id>，建会话时建好。 */
function chatSessionDirectory(id: string) {
  const dir = join(hostPorts().paths.storage(), 'chat-sessions', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 作用域会话共用的工作目录：缺失时建好，会话因此直接看到其中的全部文件。 */
function scopeDirectory(scope: SessionScope) {
  const dir = scope.directory();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 会话工作目录：会话自己的 cwd 优先；为 NULL 时按项目条目解析（通用会话用工作区根）。缺失即报错。
 *  远程项目的路径在远端，本地没有对应目录，因此跳过本地存在性检查。 */
export function sessionCwd(projectId: string | null, stored: string | null): string {
  if (stored) return stored;
  const path = projectId === null ? workspaceRoot() : hostPorts().projects.find(projectId)?.path;
  if (!path) throw new Error('项目不存在');
  if (projectId && hostPorts().projects.remoteOf(projectId)) return path;
  if (!existsSync(path) || !statSync(path).isDirectory())
    throw new Error(`项目目录不存在：${path}`);
  return path;
}

export const isRemoteSession = (meta: SessionRow) =>
  Boolean(meta.project_id && hostPorts().projects.remoteOf(meta.project_id));

export type ModelChoice =
  | { kind: 'none' }
  | {
      kind: 'unavailable';
      providerId: string;
      providerName: string | null;
      model: string;
      effort: string | null;
    }
  | { kind: 'ready'; selection: SessionModel; effortLevels: string[]; stored: boolean };

function readyChoice(
  provider: StoredLlmProvider,
  model: string,
  effort: string | null,
  stored: boolean,
): ModelChoice {
  const settings = llmModelSettings(provider, model);
  const valid = effort && settings.effortLevels.includes(effort) ? effort : null;
  return {
    kind: 'ready',
    selection: { provider, model, effort: valid ?? settings.effort ?? null },
    effortLevels: settings.effortLevels,
    stored,
  };
}

/** 会话自己的选择优先；从未选过的沿用最近发过消息的会话，那个也用不了时取第一个可用提供商的首个模型。 */
export function modelChoice(meta: SessionRow): ModelChoice {
  const providers = llmProviders();
  const usable = usableLlmProviders(providers);
  if (meta.provider_id && meta.model) {
    const provider = usable.find(({ id }) => id === meta.provider_id);
    if (provider?.models.includes(meta.model))
      return readyChoice(provider, meta.model, meta.effort, true);
    return {
      kind: 'unavailable',
      providerId: meta.provider_id,
      providerName: providers.find(({ id }) => id === meta.provider_id)?.name ?? null,
      model: meta.model,
      effort: meta.effort,
    };
  }
  const recent = hostPorts()
    .database()
    .prepare(
      'SELECT provider_id, model, effort FROM sessions WHERE message_count > 0 AND provider_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1',
    )
    .get() as Pick<SessionRow, 'provider_id' | 'model' | 'effort'> | undefined;
  const inherited = recent && usable.find(({ id }) => id === recent.provider_id);
  if (inherited && recent.model && inherited.models.includes(recent.model))
    return readyChoice(inherited, recent.model, recent.effort, false);
  const first = usable[0];
  return first ? readyChoice(first, first.models[0]!, null, false) : { kind: 'none' };
}

/** 发送与旁问都要求一个可用的模型：没配或已停用时报出能照着做的说明。 */
export function readySelection(meta: SessionRow): Extract<ModelChoice, { kind: 'ready' }> {
  const choice = modelChoice(meta);
  if (choice.kind === 'none') throw new Error('请先在设置中配置模型服务');
  if (choice.kind === 'unavailable')
    throw new Error('这个会话的模型已停用或被移除，请在输入框里另选模型');
  return choice;
}

export function storeModel(id: string, providerId: string, model: string, effort: string | null) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET provider_id=?, model=?, effort=? WHERE id=?')
    .run(providerId, model, effort, id);
}

export function storeSessionFile(id: string, file: string) {
  hostPorts().database().prepare('UPDATE sessions SET file=? WHERE id=?').run(file, id);
}

export function storeTitle(id: string, title: string) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET title=? WHERE id=?')
    .run(title.slice(0, 60), id);
}

export function storeActivity(id: string, messageCount: number) {
  hostPorts()
    .database()
    .prepare('UPDATE sessions SET message_count=?, updated_at=? WHERE id=?')
    .run(messageCount, new Date().toISOString(), id);
}

/** 归档连带子 Agent 会话；置顶只作用于会话自己。 */
export function storeVisibility(id: string, patch: { archived?: boolean; pinned?: boolean }) {
  const db = hostPorts().database();
  if (patch.archived !== undefined)
    db.prepare('UPDATE sessions SET archived=? WHERE id=? OR parent_id=?').run(
      Number(patch.archived),
      id,
      id,
    );
  if (patch.pinned !== undefined)
    db.prepare('UPDATE sessions SET pinned=? WHERE id=?').run(Number(patch.pinned), id);
}

/** 归档项目的全部会话，返回其中原先未归档的。 */
export function archiveProject(projectId: string | null): string[] {
  const db = hostPorts().database();
  const ids = db
    .prepare('SELECT id FROM sessions WHERE project_id IS ? AND archived = 0')
    .all(projectId) as { id: string }[];
  db.prepare('UPDATE sessions SET archived=1 WHERE project_id IS ?').run(projectId);
  return ids.map(({ id }) => id);
}

export const childSessionIds = (id: string) =>
  (
    hostPorts().database().prepare('SELECT id FROM sessions WHERE parent_id=?').all(id) as {
      id: string;
    }[]
  ).map((child) => child.id);

export function removeSession(id: string) {
  hostPorts().database().prepare('DELETE FROM sessions WHERE id=?').run(id);
}

const summaryColumns =
  'id, title, pinned, project_id AS projectId, updated_at AS updatedAt, created_at AS createdAt';
type SummaryRow = Omit<ChatSessionSummary, 'pinned'> & { pinned: number };
const toSummary = (row: SummaryRow): ChatSessionSummary => ({ ...row, pinned: row.pinned === 1 });

export function listSessions(projectId: string | null, query: string): ChatSessionSummary[] {
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return hostPorts()
    .database()
    .prepare(
      `SELECT ${summaryColumns} FROM sessions WHERE project_id IS ? AND archived = 0 AND message_count > 0 AND parent_id IS NULL
       ${query ? "AND title LIKE ? ESCAPE '\\'" : ''} ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
    )
    .all(...(query ? [projectId, pattern] : [projectId]))
    .map((row) => toSummary(row as SummaryRow));
}

export function archivedSessions(): ChatSessionSummary[] {
  return hostPorts()
    .database()
    .prepare(
      `SELECT ${summaryColumns} FROM sessions WHERE archived = 1 AND parent_id IS NULL ORDER BY updated_at DESC`,
    )
    .all()
    .map((row) => toSummary(row as SummaryRow));
}

/** 通用池的空会话入口：cwd 是某个作用域目录的归该作用域，其余非 NULL 的是随聊，互不复用；
 *  cwd 为 NULL 的旧会话哪边都不认，免得新会话落在别人的工作目录里。 */
function emptyGeneralSessionId(scope: ChatScope): string | undefined {
  const scoped = sessionScope(scope);
  const directories = scoped
    ? [scoped.directory()]
    : sessionScopes().map((item) => item.directory());
  const row = hostPorts()
    .database()
    .prepare(
      `SELECT id FROM sessions WHERE project_id IS NULL AND archived = 0 AND message_count = 0
       AND parent_id IS NULL AND cwd IS NOT NULL AND cwd ${scoped ? '' : 'NOT '}IN (${directories.map(() => '?').join(', ')})
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(...directories) as { id: string } | undefined;
  return row?.id;
}

/** 每个项目只保留一个空会话入口，没有时返回 undefined。 */
export function emptySessionId(projectId: string | null, scope: ChatScope): string | undefined {
  if (projectId === null) return emptyGeneralSessionId(scope);
  return (
    hostPorts()
      .database()
      .prepare(
        'SELECT id FROM sessions WHERE project_id IS ? AND archived = 0 AND message_count = 0 AND parent_id IS NULL ORDER BY updated_at DESC LIMIT 1',
      )
      .get(projectId) as { id: string } | undefined
  )?.id;
}

/** 文件在首条消息后由 Pi 写出。通用会话建自己的私有目录（随聊）或作用域目录并写进 cwd 列，
 *  项目会话留 NULL 继续按项目目录解析。 */
export function insertSession(projectId: string | null, scope: ChatScope): string {
  const id = randomUUID();
  const scoped = sessionScope(scope);
  const cwd =
    projectId !== null ? null : scoped ? scopeDirectory(scoped) : chatSessionDirectory(id);
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      'INSERT INTO sessions (id, project_id, cwd, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, projectId, cwd, '', now, now);
  return id;
}

/** 由已有会话派生出的会话文件（分支、保留下来的旁问）登记为新会话：同项目、同 cwd、同模型。 */
export function adoptSessionFile(meta: SessionRow, file: string, titlePrefix: string): string {
  const id = randomUUID();
  const userMessages = requirePiSync()
    .SessionManager.open(file)
    .buildSessionContext()
    .messages.filter((message) => message.role === 'user').length;
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      `INSERT INTO sessions (id, project_id, cwd, file, title, message_count, provider_id, model, effort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      meta.project_id,
      meta.cwd,
      file,
      `${titlePrefix}${meta.title}`.slice(0, 60),
      userMessages,
      meta.provider_id,
      meta.model,
      meta.effort,
      now,
      now,
    );
  return id;
}

/** 子 Agent 的会话：同项目、同目录，模型与推理档位取父会话当时的选择，历史为空。 */
export function insertSubagentSession(parentId: string, description: string, cwd: string): string {
  const parent = row(parentId);
  const id = randomUUID();
  const now = new Date().toISOString();
  hostPorts()
    .database()
    .prepare(
      `INSERT INTO sessions (id, project_id, cwd, file, title, provider_id, model, effort, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      parent.project_id,
      cwd,
      description.slice(0, 60),
      parent.provider_id,
      parent.model,
      parent.effort,
      parentId,
      now,
      now,
    );
  return id;
}

let piSync: typeof import('@earendil-works/pi-coding-agent') | undefined;
/** 读历史不能等异步加载：启动时先 preloadPi，之后同步取用。 */
export function requirePiSync() {
  if (!piSync) throw new Error('Pi 尚未加载');
  return piSync;
}
export async function preloadPi() {
  const { loadPi } = await import('../pi');
  piSync = await loadPi();
}
