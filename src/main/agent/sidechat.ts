/**
 * 旁问：从主会话当前位置借一份上下文问一句，不进数据库也不写会话文件，关掉就没了。
 * 实例走与主会话相同的 openPiSession（系统提示、工具与模型一致，缓存前缀因此对得上），
 * 只是会话记录放在内存里；每个主会话最多一个旁问。「保留」时才把记录写成文件、登记成新会话。
 */
import { randomUUID } from 'node:crypto';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult, ChatAskInput, SidechatView, WorkspaceChat } from '../../shared/api';
import { agentEnvironment } from './environment';
import { bindSessionExtensions, releaseExtensionUi, shutdownSession } from './extensions';
import { releaseChatAttachments } from './media';
import { loadPi, openPiSession, writeSessionFile } from './pi';
import {
  adoptSessionFile,
  composePrompt,
  projectMessages,
  row,
  send,
  sidechatSource,
  toolOutput,
  withoutToolImages,
} from './session';

interface Side {
  session: AgentSession;
  /** 扩展 UI 的会话身份：不与主会话共用，关闭旁问时只清它自己的扩展状态。 */
  uiId: string;
  /** 借来的主会话消息条数：界面只显示这之后的旁问内容。 */
  baseCount: number;
  run?: { cancelled: boolean; tool?: string; done: Promise<void> };
  steps: Map<string, AgentToolResult>;
  streamedAt: number;
  unsubscribe: () => void;
}

const sides = new Map<string, Side>();
const opening = new Map<string, Promise<Side>>();

function view(parentId: string, side: Side): SidechatView {
  return {
    parentId,
    running: Boolean(side.run),
    activeTool: side.run?.tool,
    messages: projectMessages(
      side.session.messages.slice(side.baseCount),
      side.steps,
      Boolean(side.run),
    ),
  };
}

function publish(parentId: string, side: Side) {
  send('sidechat:on-update', view(parentId, side));
}

function stream(parentId: string, side: Side) {
  const now = Date.now();
  if (now - side.streamedAt < 100) return;
  side.streamedAt = now;
  const streaming = side.session.state.streamingMessage;
  const messages = side.session.messages.slice(side.baseCount);
  const last = projectMessages(
    streaming ? [...messages, streaming] : messages,
    side.steps,
    true,
  ).at(-1);
  if (last?.role === 'assistant')
    send('sidechat:on-stream', {
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
      publish(parentId, side);
      break;
  }
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
    uiId: randomUUID(),
    baseCount: session.messages.length,
    steps: new Map(),
    streamedAt: 0,
    unsubscribe: () => {},
  };
  side.unsubscribe = session.subscribe((event) => onEvent(parentId, side, event));
  // 旁问没有标题可改：扩展的 setTitle 忽略。
  await bindSessionExtensions(side.uiId, session, { setTitle: () => {} });
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
  const { prompt, images } = composePrompt(input, side.session.sessionManager.getCwd());
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
  releaseExtensionUi(side.uiId);
  await shutdownSession(side.session, 'quit').catch(() => {});
  send('sidechat:on-closed', parentId);
}

/** 保留为新会话：借来的历史加旁问内容写成会话文件，标题加「旁问：」，然后关闭旁问。 */
export async function keepSidechat(parentId: string): Promise<WorkspaceChat> {
  const side = requireSide(parentId);
  if (side.run) throw new Error('请等待旁问回答完成');
  if (side.session.messages.length === side.baseCount) throw new Error('旁问还没有内容');
  const manager = side.session.sessionManager;
  const header = manager.getHeader();
  if (!header) throw new Error('旁问记录缺少会话头');
  const file = writeSessionFile(header, manager.getEntries());
  const chat = adoptSessionFile(row(parentId), file, '旁问：');
  await closeSidechat(parentId);
  return chat;
}

export function hasSidechats(): boolean {
  return sides.size > 0;
}

export function shutdownSidechats(): Promise<void> {
  return Promise.all([...sides.keys()].map(closeSidechat)).then(() => {});
}
