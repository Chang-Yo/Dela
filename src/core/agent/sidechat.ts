/**
 * 旁问：从主会话当前位置借一份上下文问一句，不进数据库也不写会话文件，关掉就没了。
 * 实例走与主会话相同的 openPiSession（系统提示、工具与模型一致，缓存前缀因此对得上），
 * 只是会话记录放在内存里；每个主会话最多一个旁问。「保留」时才把记录写成文件、登记成新会话。
 */
import { existsSync } from 'node:fs';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult, ChatAskInput, SidechatView, WorkspaceChat } from '../protocol/agent';
import { agentEnvironment } from './environment';
import { releaseChatAttachments } from './media';
import { loadPi, openPiSession, writeSessionFile } from './pi';
import { usableLlmProviders } from './providers';
import { live } from './session/live';
import {
  projectMessages,
  snapshot,
  splitMeta,
  textOf,
  toolOutput,
  withoutToolImages,
} from './session/projection';
import { composePrompt } from './session/prompt';
import { adoptSessionFile, readySelection, row, sessionCwd } from './session/store';
import { hostPorts } from '../ports';

interface Side {
  session: AgentSession;
  providerId: string;
  /** 借来的主会话条目：Pi 压缩后消息数量会变化，不能用数组下标作为边界。 */
  baseEntryIds: Set<string>;
  run?: { cancelled: boolean; tool?: string; done: Promise<void> };
  steps: Map<string, AgentToolResult>;
  streamedAt: number;
  unsubscribe: () => void;
}

const sides = new Map<string, Side>();
const opening = new Map<string, Promise<Side>>();

function messages(side: Side) {
  return side.session.sessionManager
    .buildSessionProjection()
    .entries.flatMap(({ sourceEntry, messages }) =>
      side.baseEntryIds.has(sourceEntry.id) ? [] : messages,
    );
}

function view(parentId: string, side: Side): SidechatView {
  return {
    parentId,
    running: Boolean(side.run),
    activeTool: side.run?.tool,
    messages: projectMessages(messages(side), side.steps, Boolean(side.run)),
  };
}

function publish(parentId: string, side: Side) {
  hostPorts().broadcaster.send('sidechat:on-update', view(parentId, side));
}

function stream(parentId: string, side: Side) {
  const now = Date.now();
  if (now - side.streamedAt < 100) return;
  side.streamedAt = now;
  const streaming = side.session.state.streamingMessage;
  const ownMessages = messages(side);
  const last = projectMessages(
    streaming ? [...ownMessages, streaming] : ownMessages,
    side.steps,
    true,
  ).at(-1);
  if (last?.role === 'assistant')
    hostPorts().broadcaster.send('sidechat:on-stream', {
      sessionId: parentId,
      message: withoutToolImages(last),
      activeTool: side.run?.tool,
    });
}

function onEvent(parentId: string, side: Side, event: AgentSessionEvent) {
  switch (event.type) {
    case 'tool_execution_start':
      side.steps.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.args,
        startedAt: Date.now(),
      });
      if (side.run) side.run.tool = event.toolName;
      publish(parentId, side);
      break;
    case 'tool_execution_update': {
      const step = side.steps.get(event.toolCallId);
      if (step) step.output = toolOutput(event.partialResult ?? {});
      stream(parentId, side);
      break;
    }
    case 'tool_execution_end': {
      const step = side.steps.get(event.toolCallId);
      if (step) {
        step.output = {
          ...toolOutput(event.result ?? {}),
          ...(event.isError ? { isError: true } : {}),
        };
        step.finishedAt = Date.now();
      }
      if (side.run) side.run.tool = undefined;
      publish(parentId, side);
      break;
    }
    case 'message_update':
      stream(parentId, side);
      break;
    case 'message_end':
      // Pi 先通知监听者再把这条消息写进会话记录，而旁问的快照读的是记录：等写入后再推送。
      queueMicrotask(() => publish(parentId, side));
      break;
  }
}

/**
 * 旁问的起点：主会话当前分支上的记录。主会话正在回答时退到这一轮提问之前，
 * 旁问看不到还没答完的那一轮。
 */
async function sidechatSource(id: string) {
  const meta = row(id);
  const { selection } = readySelection(meta);
  const entry = live.get(id);
  const manager =
    entry?.session.sessionManager ??
    (existsSync(meta.file) ? (await loadPi()).SessionManager.open(meta.file) : null);
  let branch = manager?.getBranch() ?? [];
  // 本轮提问可能还没写进记录（发送前要先拍目录快照），按 turnId 认，不能只看最后一条用户消息。
  const turnId = entry?.run?.id;
  const asking = turnId
    ? branch.findIndex(
        (item) =>
          item.type === 'message' &&
          item.message.role === 'user' &&
          splitMeta(textOf(item.message.content)).meta.turnId === turnId,
      )
    : -1;
  if (asking >= 0) branch = branch.slice(0, asking);
  const cwd = entry?.cwd ?? sessionCwd(meta.project_id, meta.cwd);
  return { meta, cwd, selection, branch };
}

async function createSide(parentId: string): Promise<Side> {
  const { meta, cwd, selection, branch } = await sidechatSource(parentId);
  const pi = await loadPi();
  const inMemory = pi.SessionManager.inMemory(
    cwd,
    meta.file ? { parentSession: meta.file } : undefined,
    branch,
  );
  const session = await openPiSession({
    cwd,
    inMemory,
    selection,
    ...(await agentEnvironment().sessionOptions(meta.project_id, cwd)),
  });
  const side: Side = {
    session,
    providerId: selection.provider.id,
    baseEntryIds: new Set(session.sessionManager.getBranch().map(({ id }) => id)),
    steps: new Map(),
    streamedAt: 0,
    unsubscribe: () => {},
  };
  side.unsubscribe = session.subscribe((event) => onEvent(parentId, side, event));
  return side;
}

/** 打开（或回到）这个会话的旁问。 */
export async function openSidechat(parentId: string): Promise<SidechatView> {
  const existing = sides.get(parentId);
  if (existing) return view(parentId, existing);
  let pending = opening.get(parentId);
  if (!pending) {
    pending = createSide(parentId).finally(() => opening.delete(parentId));
    opening.set(parentId, pending);
  }
  const side = await pending;
  sides.set(parentId, side);
  return view(parentId, side);
}

function requireSide(parentId: string): Side {
  const side = sides.get(parentId);
  if (!side) throw new Error('旁问已关闭');
  return side;
}

/** 旁问里问一句：与主会话相同的提问组装（@ 引用、附件、评论），没有会话命令和编辑重发。 */
export async function askSidechat(parentId: string, input: ChatAskInput): Promise<SidechatView> {
  const side = requireSide(parentId);
  if (side.run) throw new Error('请等待旁问回答完成');
  if (!usableLlmProviders().some(({ id }) => id === side.providerId))
    throw new Error('模型提供商已停用或不可用，请重新启用');
  const { prompt, images } = composePrompt(input, row(parentId).project_id);
  let finish!: () => void;
  const run = { cancelled: false, done: new Promise<void>((resolve) => (finish = resolve)) };
  side.run = run;
  publish(parentId, side);
  try {
    await side.session.prompt(prompt, images.length ? { images } : undefined);
  } finally {
    releaseChatAttachments(input.attachments);
    side.run = undefined;
    side.steps.clear();
    if (sides.get(parentId) === side) publish(parentId, side);
    finish();
  }
  return view(parentId, side);
}

export function cancelSidechat(parentId: string) {
  const side = sides.get(parentId);
  if (side?.run) side.run.cancelled = true;
  void side?.session.abort();
}

/** 关闭旁问：正在回答就先中断，内容随实例丢弃。 */
export async function closeSidechat(parentId: string): Promise<void> {
  const side = sides.get(parentId) ?? (await opening.get(parentId)?.catch(() => undefined));
  if (!side) return;
  sides.delete(parentId);
  if (side.run) {
    side.run.cancelled = true;
    await side.session.abort();
    await side.run.done;
  }
  side.unsubscribe();
  side.session.dispose();
  hostPorts().broadcaster.send('sidechat:on-closed', parentId);
}

/** 保留为新会话：借来的历史加旁问内容写成会话文件，标题加「旁问：」，然后关闭旁问。 */
export async function keepSidechat(parentId: string): Promise<WorkspaceChat> {
  const side = requireSide(parentId);
  if (side.run) throw new Error('请等待旁问回答完成');
  if (!messages(side).length) throw new Error('旁问还没有内容');
  const manager = side.session.sessionManager;
  const header = manager.getHeader();
  if (!header) throw new Error('旁问记录缺少会话头');
  const file = writeSessionFile(header, manager.getEntries());
  const chat = snapshot(adoptSessionFile(row(parentId), file, '旁问：'));
  await closeSidechat(parentId);
  return chat;
}

export function hasSidechats(): boolean {
  return sides.size > 0;
}

export function shutdownSidechats(): Promise<void> {
  return Promise.all([...sides.keys()].map(closeSidechat)).then(() => {});
}
