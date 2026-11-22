// 投影：Pi 的消息与会话状态 → 界面的 WorkspaceChat。<dela-meta> 的编解码只在这里，
// 界面与跨会话读取都看不到 Pi 的记录格式。
import { existsSync } from 'node:fs';
import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type {
  AgentToolResult,
  ContextUsageView,
  TaskNoticeDetails,
  WorkspaceChat,
} from '../../protocol/agent';
import { emit } from '../../ports';
import { agentContract } from '../../protocol/agent';
import { runningTasks } from '../tasks';
import { live, liveSteps, type Live } from './live';
import { modelChoice, requirePiSync, row, sessionCwd, type ModelChoice } from './store';

type ChatMessage = WorkspaceChat['messages'][number];

export const TASK_NOTICE = 'dela-task';

export const textOf = (content: string | (TextContent | ImageContent)[]) =>
  typeof content === 'string'
    ? content
    : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

const META_PREFIX = '<dela-meta>';
const META_SUFFIX = '</dela-meta>\n';

type UserMessageMeta = Omit<Partial<ChatMessage>, 'attachments'> & {
  body?: string;
  attachments?: { id?: string; name: string }[];
};

export const encodeMeta = (meta: UserMessageMeta & { turnId: string }) =>
  `${META_PREFIX}${JSON.stringify(meta)}${META_SUFFIX}`;

export function splitMeta(text: string): { meta: UserMessageMeta; text: string; rest?: string } {
  if (!text.startsWith(META_PREFIX)) return { meta: {}, text };
  const end = text.indexOf(META_SUFFIX);
  if (end < 0) return { meta: {}, text };
  try {
    const meta = JSON.parse(text.slice(META_PREFIX.length, end)) as UserMessageMeta;
    return { meta, text: meta.body ?? '', rest: text.slice(end + META_SUFFIX.length) };
  } catch {
    return { meta: {}, text };
  }
}

export const queuedTexts = (steering: readonly string[]) =>
  steering.map((text) => splitMeta(text).text);

export function toolOutput(result: {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
}) {
  const image = (result.content ?? []).find((block) => block.type === 'image');
  return {
    text: textOf(result.content ?? []),
    ...(image ? { image: { mimeType: image.mimeType, data: image.data } } : {}),
    ...(result.details !== undefined ? { details: result.details } : {}),
  };
}

/** running 时末条回复不写 finishedAt（renderer 据此合并流式增量）；已完成的回复带本轮最后条目作分支锚点。 */
export function projectMessages(
  messages: AgentMessage[],
  pending?: Map<string, AgentToolResult>,
  running = false,
  entryIds?: (string | undefined)[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  let reply: ChatMessage | null = null;
  let lastUserAt = 0;
  let lastTurnId: string | undefined;
  const results = new Map<string, AgentToolResult>();
  for (const [index, message] of messages.entries()) {
    const entryId = entryIds?.[index];
    if (message.role === 'user') {
      lastUserAt = message.timestamp;
      const { meta, text } = splitMeta(textOf(message.content));
      lastTurnId = meta.turnId;
      out.push({ role: 'user', content: text, ...meta });
      reply = null;
    } else if (message.role === 'assistant') {
      if (!reply) {
        reply = {
          role: 'assistant',
          content: '',
          parts: [],
          toolResults: [],
          startedAt: lastUserAt || message.timestamp,
          ...(lastTurnId ? { turnId: lastTurnId } : {}),
        };
        out.push(reply);
      }
      for (const block of message.content) {
        if (block.type === 'thinking' && block.thinking.trim())
          reply.parts!.push({ type: 'reasoning', text: block.thinking });
        else if (block.type === 'text' && block.text)
          reply.parts!.push({ type: 'text', text: block.text });
        else if (block.type === 'toolCall') {
          const step: AgentToolResult = pending?.get(block.id) ?? {
            id: block.id,
            name: block.name,
            input: block.arguments,
          };
          results.set(block.id, step);
          const last = reply.parts!.at(-1);
          if (last?.type === 'tools') last.results.push(step);
          else reply.parts!.push({ type: 'tools', results: [step] });
          reply.toolResults!.push(step);
        }
      }
      reply.content = reply
        .parts!.flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n\n');
      if (message.stopReason === 'aborted') reply.stopped = true;
      if (message.stopReason === 'error') {
        reply.interrupted = true;
        const notice = `本次执行中断：${message.errorMessage ?? '未知错误'}`;
        reply.parts!.push({ type: 'text', text: notice });
        reply.content = reply.content ? `${reply.content}\n\n${notice}` : notice;
      }
      reply.finishedAt = message.timestamp + (message.durationMs ?? 0);
      if (entryId) reply.entryId = entryId;
    } else if (message.role === 'toolResult') {
      const step = results.get(message.toolCallId);
      if (step) {
        step.output = { ...toolOutput(message), ...(message.isError ? { isError: true } : {}) };
        step.finishedAt = message.timestamp;
      }
      if (entryId && reply) reply.entryId = entryId;
    } else if (message.role === 'custom' && message.customType === TASK_NOTICE) {
      // 唤醒父会话的通知开启新的一轮：随后的回复从通知算起，审阅对应这一轮。
      // 界面只显示正文；早期的通知没有 bodyStart，整段显示。
      const { bodyStart = 0, ...details } = message.details as TaskNoticeDetails & {
        bodyStart?: number;
      };
      if (details.turnId) {
        lastUserAt = message.timestamp;
        lastTurnId = details.turnId;
      }
      out.push({
        role: 'assistant',
        content: textOf(message.content).slice(bodyStart),
        parts: [],
        task: details,
      });
      reply = null;
    } else if (message.role === 'custom') {
      // 扩展的可见消息自成一条，不并进前后的模型回复；display=false 的只给模型看。
      // appendEntry 写的扩展状态不是消息，根本不会出现在这里。
      if (message.display) {
        out.push({
          role: 'assistant',
          content: textOf(message.content),
          parts: [],
          extension: { customType: message.customType },
        });
        reply = null;
      }
    } else if (message.role === 'compactionSummary') {
      out.push({
        role: 'assistant',
        content: '（此前的对话已压缩为摘要）',
        parts: [],
        compacted: true,
      });
      reply = null;
    }
  }
  const last = out.at(-1);
  if (running && last?.role === 'assistant') {
    delete last.finishedAt;
    delete last.entryId;
  }
  if (running && (last?.role === 'user' || last?.task))
    out.push({
      role: 'assistant',
      content: '',
      parts: [],
      toolResults: [],
      startedAt: lastUserAt,
      ...(lastTurnId ? { turnId: lastTurnId } : {}),
    });
  return out;
}

// 界面显示整条分支，而不是 Pi 给模型的上下文（从摘要开始）：
// 压缩前的历史照常可见，压缩标记落在压缩发生的位置。
function branchMessages(manager: Pick<SessionManager, 'getBranch'>) {
  const { sessionEntryToContextMessages } = requirePiSync();
  return manager.getBranch().flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({
      message,
      entryId: entry.type === 'message' ? entry.id : undefined,
    })),
  );
}

function storedMessages(manager: Pick<SessionManager, 'getBranch'>): ChatMessage[] {
  const branch = branchMessages(manager);
  return projectMessages(
    branch.map(({ message }) => message),
    undefined,
    false,
    branch.map(({ entryId }) => entryId),
  );
}

/** 运行中的分支：Pi 先通知再落盘，上下文比已落盘的上下文多出的尾部就是还没写入的消息。 */
export function liveMessages(session: AgentSession, streaming?: AgentMessage): AgentMessage[] {
  const manager = session.sessionManager;
  const unsaved = session.messages.slice(manager.buildSessionProjection().messages.length);
  return [
    ...branchMessages(manager).map(({ message }) => message),
    ...unsaved,
    ...(streaming ? [streaming] : []),
  ];
}

function readMessages(id: string): ChatMessage[] {
  const file = row(id).file;
  if (!existsSync(file)) return [];
  try {
    const { SessionManager } = requirePiSync();
    return storedMessages(SessionManager.open(file));
  } catch {
    return [];
  }
}

/** 流式增量不带工具图片：图片已随工具结束的全量快照到过渲染端，
 *  而 ~100ms 一帧的增量重传 base64 会让 IPC 包随图片体积与历史步骤线性膨胀。 */
export function withoutToolImages(message: ChatMessage): ChatMessage {
  const strip = (step: AgentToolResult): AgentToolResult => {
    if (!step.output?.image) return step;
    const { image: _image, ...output } = step.output;
    return { ...step, output };
  };
  const parts = message.parts?.map((part) =>
    part.type === 'tools' ? { ...part, results: part.results.map(strip) } : part,
  );
  return {
    ...message,
    ...(message.toolResults && { toolResults: message.toolResults.map(strip) }),
    ...(parts && { parts }),
  };
}

export function usageOf(entry: Live | undefined): ContextUsageView | null {
  // 一次聚合同时取上下文占用与累计用量：分开调用会让按消息估算的重活在同一个流式节拍里做两遍。
  return entry ? contextUsageView(entry.session.getSessionStats(), entry.compactedTokens) : null;
}

/** Pi 会话统计 → 上下文用量。压缩后下次回复前 Pi 给不出用量（tokens 为 null），用 compactedTokens 估计顶上。 */
export function contextUsageView(
  stats: Pick<ReturnType<AgentSession['getSessionStats']>, 'contextUsage' | 'tokens'>,
  compactedTokens?: number,
): ContextUsageView | null {
  const usage = stats.contextUsage;
  if (!usage) return null;
  const estimate =
    usage.tokens === null && compactedTokens !== undefined && usage.contextWindow > 0
      ? {
          tokens: compactedTokens,
          percent: (compactedTokens / usage.contextWindow) * 100,
          estimated: true,
        }
      : null;
  // 缓存命中率取本会话累计（含已压缩或被分支抛弃的历史）；提供商不上报缓存时恒为 0，
  // 会被读成「一次没命中」，所以仅在出现过缓存读写时才带这两个字段。
  const { input, cacheRead, cacheWrite } = stats.tokens;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    ...estimate,
    ...(cacheRead + cacheWrite > 0 ? { inputTokens: input, cachedTokens: cacheRead } : {}),
  };
}

function modelView(choice: ModelChoice) {
  if (choice.kind === 'ready')
    return {
      configured: true,
      providerId: choice.selection.provider.id,
      providerName: choice.selection.provider.name,
      model: choice.selection.model,
      modelUnavailable: false,
      effortLevels: choice.effortLevels,
      effort: choice.selection.effort,
    };
  if (choice.kind === 'unavailable')
    return {
      configured: true,
      providerId: choice.providerId,
      providerName: choice.providerName,
      model: choice.model,
      modelUnavailable: true,
      effortLevels: [],
      effort: choice.effort,
    };
  return {
    configured: false,
    providerId: null,
    providerName: null,
    model: '',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
  };
}

export function snapshot(id: string): WorkspaceChat {
  const entry = live.get(id);
  const meta = row(id);
  let choice: ModelChoice = { kind: 'none' };
  try {
    choice = modelChoice(meta);
  } catch {
    // 凭据不可读时只显示未配置状态。
  }
  let cwd: string | null = entry?.cwd ?? null;
  try {
    cwd ??= sessionCwd(meta.project_id, meta.cwd);
  } catch {
    // 项目目录缺失：快照照常展示历史，发送时由会话运行层报出具体错误。
  }
  return {
    sessionId: id,
    projectId: meta.project_id,
    cwd,
    ...modelView(choice),
    contextUsage: usageOf(entry),
    messages: entry
      ? entry.run
        ? projectMessages(liveMessages(entry.session), liveSteps.get(id), true)
        : storedMessages(entry.session.sessionManager)
      : readMessages(id),
    running: Boolean(entry?.run),
    activeTool: entry?.run?.tool,
    compacting: entry?.session.isCompacting ?? false,
    queued: queuedTexts(entry?.session.getSteeringMessages() ?? []),
    tasks: runningTasks(id),
    ...(meta.parent_id ? { subagent: { parentId: meta.parent_id, description: meta.title } } : {}),
  };
}

export function publish(id: string) {
  emit(agentContract, 'session-update', { sessionId: id, chat: snapshot(id) });
}
