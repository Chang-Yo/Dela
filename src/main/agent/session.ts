/**
 * 会话层：SQLite 只存索引（项目归属、标题、置顶、归档、JSONL 路径），完整记录是 Pi 的会话文件。
 * 每个打开的会话在内存里保留一个 Pi AgentSession；cwd 恒为会话所属项目的目录（通用会话为工作区根），
 * 解析失败直接报错，不静默换目录。renderer 看到的 WorkspaceChat 是 Pi 消息的投影。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import type { WebContents } from 'electron';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type {
  AgentToolResult,
  ChatAskInput,
  ChatSessionSummary,
  ContextUsageView,
  RunStatus,
  WorkspaceChat,
} from '../../shared/api';
import { parseChatBlocks, stripChatImageTokens } from '../../shared/chat-input';
import { getDatabase } from '../database';
import { getActiveLlmProvider } from './providers';
import { openPiSession } from './pi';
import { agentEnvironment } from './environment';
import { remoteProjectOf } from '../workspace/api';
import { readChatAttachment, readChatMediaBytes, releaseChatAttachments } from './media';
import { notifyRunFinished } from '../settings/task-notify';

type ChatMessage = WorkspaceChat['messages'][number];

interface SessionRow {
  id: string;
  project_id: string | null;
  file: string;
  title: string;
}

interface Live {
  session: AgentSession;
  cwd: string;
  /** 当前 Run（ask 进行中）；空闲为 undefined。 */
  run?: { id: string; tool?: string };
  /** 本轮用户消息的展示元数据（引用、图片、附件），按 Pi 消息时间戳对齐。 */
  unsubscribe: () => void;
  stale?: boolean;
}

const live = new Map<string, Live>();
const clients = new Set<WebContents>();

export function subscribeChat(client: WebContents) {
  if (clients.has(client)) return;
  clients.add(client);
  client.once('destroyed', () => clients.delete(client));
}

function send(channel: string, ...args: unknown[]) {
  for (const client of clients) if (!client.isDestroyed()) client.send(channel, ...args);
}

function row(id: string): SessionRow {
  const found = getDatabase()
    .prepare('SELECT id, project_id, file, title FROM sessions WHERE id=?')
    .get(id) as SessionRow | undefined;
  if (!found) throw new Error('会话不存在');
  return found;
}

/** 项目目录：项目条目的 local_path；通用会话用工作区根。缺失即报错。
 *  远程项目的路径在远端，本地没有对应目录，因此跳过本地存在性检查。 */
function sessionCwd(projectId: string | null): string {
  const path =
    projectId === null
      ? agentEnvironment().workspaceRoot()
      : (
          getDatabase()
            .prepare(
              "SELECT local_path AS path FROM workspace_entries WHERE id=? AND kind='project'",
            )
            .get(projectId) as { path: string | null } | undefined
        )?.path;
  if (!path) throw new Error('项目不存在');
  if (projectId && remoteProjectOf(projectId)) return path;
  if (!existsSync(path) || !statSync(path).isDirectory())
    throw new Error(`项目目录不存在：${path}`);
  return path;
}

async function ensureLive(id: string): Promise<Live> {
  const existing = live.get(id);
  if (existing) return existing;
  const provider = getActiveLlmProvider();
  if (!provider) throw new Error('请先在设置中配置模型服务');
  const meta = row(id);
  const cwd = sessionCwd(meta.project_id);
  const environment = agentEnvironment();
  const session = await openPiSession({
    cwd,
    file: existsSync(meta.file) ? meta.file : undefined,
    provider,
    ...(await environment.sessionOptions(meta.project_id, cwd)),
  });
  if (session.sessionFile && session.sessionFile !== meta.file)
    getDatabase().prepare('UPDATE sessions SET file=? WHERE id=?').run(session.sessionFile, id);
  const entry: Live = { session, cwd, unsubscribe: () => {} };
  entry.unsubscribe = session.subscribe((event) => onEvent(id, entry, event));
  live.set(id, entry);
  return entry;
}

/** 模型或能力配置改变：空闲实例立即丢弃，运行中的轮末丢弃，下次使用时按新配置重建。 */
export function invalidateSessions() {
  for (const [id, entry] of live) {
    if (!entry.run) {
      entry.unsubscribe();
      entry.session.dispose();
      live.delete(id);
    } else {
      entry.stale = true;
    }
  }
}

// ===== Pi 消息 → WorkspaceChat 投影 =====

const textOf = (content: string | (TextContent | ImageContent)[]) =>
  typeof content === 'string'
    ? content
    : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

/** 用户消息里 Dela 附加的前言（引用与附件）不进展示；元数据在 details 前缀里。 */
const META_PREFIX = '<dela-meta>';
const META_SUFFIX = '</dela-meta>\n';

function splitMeta(text: string): { meta: Partial<ChatMessage>; text: string } {
  if (!text.startsWith(META_PREFIX)) return { meta: {}, text };
  const end = text.indexOf(META_SUFFIX);
  if (end < 0) return { meta: {}, text };
  try {
    const meta = JSON.parse(text.slice(META_PREFIX.length, end)) as Partial<ChatMessage> & {
      body?: string;
    };
    return { meta, text: meta.body ?? '' };
  } catch {
    return { meta: {}, text };
  }
}

function toolOutput(result: { content?: (TextContent | ImageContent)[]; details?: unknown }) {
  return {
    text: textOf(result.content ?? []),
    ...(result.details !== undefined ? { details: result.details } : {}),
  };
}

/** running：会话正在执行时末条回复不写 finishedAt（renderer 据此合并流式增量）。 */
export function projectMessages(
  messages: AgentMessage[],
  pending?: Map<string, AgentToolResult>,
  running = false,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  let reply: ChatMessage | null = null;
  let lastUserAt = 0;
  const results = new Map<string, AgentToolResult>();
  for (const message of messages) {
    if (message.role === 'user') {
      lastUserAt = message.timestamp;
      const { meta, text } = splitMeta(textOf(message.content));
      out.push({ role: 'user', content: text, ...meta });
      reply = null;
    } else if (message.role === 'assistant') {
      if (!reply) {
        // 一轮回复以用户消息的时间戳为 startedAt：占位、流式与落定的快照是同一条消息。
        reply = {
          role: 'assistant',
          content: '',
          parts: [],
          toolResults: [],
          startedAt: lastUserAt || message.timestamp,
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
    } else if (message.role === 'toolResult') {
      const step = results.get(message.toolCallId);
      if (step) {
        step.output = { ...toolOutput(message), ...(message.isError ? { isError: true } : {}) };
        step.finishedAt = message.timestamp;
      }
    } else if (message.role === 'compactionSummary') {
      // 压缩点之前的历史仍在 JSONL；投影只保留摘要后的上下文，开头标注一条。
      out.push({
        role: 'assistant',
        content: '（较早的对话已压缩为摘要）',
        parts: [],
        compacted: true,
      });
      reply = null;
    }
  }
  const last = out.at(-1);
  if (running && last?.role === 'assistant') delete last.finishedAt;
  if (running && last?.role === 'user')
    out.push({ role: 'assistant', content: '', parts: [], toolResults: [], startedAt: lastUserAt });
  return out;
}

function snapshot(id: string): WorkspaceChat {
  let provider: ReturnType<typeof getActiveLlmProvider> = null;
  try {
    provider = getActiveLlmProvider();
  } catch {
    // 凭据不可读时只显示未配置状态。
  }
  const entry = live.get(id);
  const meta = row(id);
  let cwd: string | null = entry?.cwd ?? null;
  try {
    cwd ??= sessionCwd(meta.project_id);
  } catch {
    // 项目目录缺失：快照照常展示历史，发送时由 ensureLive 报出具体错误。
  }
  const effortLevels = provider?.effortLevels ?? [];
  return {
    sessionId: id,
    projectId: meta.project_id,
    cwd,
    configured: Boolean(provider),
    providerName: provider?.name ?? null,
    model: provider?.model ?? '',
    models: provider?.models ?? [],
    effortLevels,
    effort: effortLevels.length ? (provider?.effort ?? effortLevels[0]!) : null,
    contextUsage: usageOf(entry),
    messages: entry
      ? projectMessages(entry.session.messages, liveSteps.get(id), Boolean(entry.run))
      : readMessages(id),
    running: Boolean(entry?.run),
    activeTool: entry?.run?.tool,
    compacting: entry?.session.isCompacting ?? false,
  };
}

function usageOf(entry: Live | undefined): ContextUsageView | null {
  if (!entry) return null;
  // 一次聚合同时取上下文占用与累计用量：getSessionStats 内部已算过 getContextUsage，
  // 分开调用会把这件按消息估算的重活在同一个流式节拍里做两遍。
  const stats = entry.session.getSessionStats();
  const usage = stats.contextUsage;
  if (!usage) return null;
  // 缓存命中率的分子分母都取本会话累计：SessionStats 聚合会话文件里的全部条目（含已被
  // 压缩或被分支抛弃的历史，那些请求确实按缓存价计过费）。提供商不上报缓存时这里恒为 0，
  // 直接下发会被读成「一次都没命中」，所以只在出现过缓存读或写时才带上这两个字段。
  const { input, cacheRead, cacheWrite } = stats.tokens;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    ...(cacheRead + cacheWrite > 0 ? { inputTokens: input, cachedTokens: cacheRead } : {}),
  };
}

/** 未打开的会话：直接读 JSONL 投影（不建 Pi 实例，避免打开历史就要求模型配置）。 */
function readMessages(id: string): ChatMessage[] {
  const file = row(id).file;
  if (!existsSync(file)) return [];
  try {
    const { SessionManager } = requirePiSync();
    return projectMessages(SessionManager.open(file).buildSessionContext().messages);
  } catch {
    return [];
  }
}

let piSync: typeof import('@earendil-works/pi-coding-agent') | undefined;
function requirePiSync() {
  if (!piSync) throw new Error('Pi 尚未加载');
  return piSync;
}
export async function preloadPi() {
  const { loadPi } = await import('./pi');
  piSync = await loadPi();
}

function publish(id: string) {
  send('session:on-update', id, snapshot(id));
}

// ===== 事件 =====

/** 运行中的工具步骤（含 start/update 期间的输入与增量输出），按 toolCallId 索引。 */
const liveSteps = new Map<string, Map<string, AgentToolResult>>();
const streamTimers = new Map<string, number>();

function onEvent(id: string, entry: Live, event: AgentSessionEvent) {
  const steps = liveSteps.get(id) ?? new Map<string, AgentToolResult>();
  liveSteps.set(id, steps);
  switch (event.type) {
    case 'tool_execution_start':
      steps.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.args,
        startedAt: Date.now(),
      });
      if (entry.run) entry.run.tool = event.toolName;
      runEvent(id, 'running', event.toolName);
      publish(id);
      break;
    case 'tool_execution_update': {
      const step = steps.get(event.toolCallId);
      if (step) step.output = toolOutput(event.partialResult ?? {});
      stream(id, entry);
      break;
    }
    case 'tool_execution_end': {
      const step = steps.get(event.toolCallId);
      if (step) {
        step.output = {
          ...toolOutput(event.result ?? {}),
          ...(event.isError ? { isError: true } : {}),
        };
        step.finishedAt = Date.now();
      }
      if (entry.run) entry.run.tool = undefined;
      runEvent(id, 'running');
      publish(id);
      break;
    }
    case 'message_update':
      stream(id, entry);
      break;
    case 'message_end':
    case 'compaction_start':
    case 'compaction_end':
      touch(id, entry);
      publish(id);
      break;
  }
}

/** 流式期 ~100ms 节流推送末条 assistant 消息（含未完成的流式消息）。 */
function stream(id: string, entry: Live) {
  const now = Date.now();
  if (now - (streamTimers.get(id) ?? 0) < 100) return;
  streamTimers.set(id, now);
  const streaming = entry.session.state.streamingMessage;
  const messages = projectMessages(
    streaming ? [...entry.session.messages, streaming] : entry.session.messages,
    liveSteps.get(id),
    true,
  );
  const last = messages.at(-1);
  if (last?.role === 'assistant')
    send('session:on-stream', {
      sessionId: id,
      message: last,
      activeTool: entry.run?.tool,
      contextUsage: usageOf(entry),
    });
}

function touch(id: string, entry: Live) {
  const count = entry.session.messages.filter((m) => m.role === 'user').length;
  getDatabase()
    .prepare('UPDATE sessions SET message_count=?, updated_at=? WHERE id=?')
    .run(count, new Date().toISOString(), id);
}

function runEvent(sessionId: string, status: RunStatus, activeTool?: string) {
  const entry = live.get(sessionId);
  send('session:on-run-event', {
    sessionId,
    runId: entry?.run?.id ?? '',
    status,
    activeTool,
  });
}

// ===== Session API =====

const summaryColumns =
  'id, title, pinned, project_id AS projectId, updated_at AS updatedAt, message_count AS messageCount';

export function listSessions(projectId: string | null, query: string): ChatSessionSummary[] {
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return getDatabase()
    .prepare(
      `SELECT ${summaryColumns} FROM sessions WHERE project_id IS ? AND archived = 0 AND message_count > 0
       ${query ? "AND title LIKE ? ESCAPE '\\'" : ''} ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
    )
    .all(...(query ? [projectId, pattern] : [projectId])) as ChatSessionSummary[];
}

export function archivedSessions(): ChatSessionSummary[] {
  return getDatabase()
    .prepare(`SELECT ${summaryColumns} FROM sessions WHERE archived = 1 ORDER BY updated_at DESC`)
    .all() as ChatSessionSummary[];
}

/** 每个项目只保留一个空会话入口；文件在首条消息后由 Pi 写出。 */
export function newSession(projectId: string | null): WorkspaceChat {
  sessionCwd(projectId);
  const empty = getDatabase()
    .prepare(
      'SELECT id FROM sessions WHERE project_id IS ? AND archived = 0 AND message_count = 0 ORDER BY updated_at DESC LIMIT 1',
    )
    .get(projectId) as { id: string } | undefined;
  if (empty && !live.get(empty.id)?.run) return snapshot(empty.id);
  const id = randomUUID();
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      'INSERT INTO sessions (id, project_id, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, '', now, now);
  return snapshot(id);
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
  const db = getDatabase();
  if (patch.archived !== undefined)
    db.prepare('UPDATE sessions SET archived=? WHERE id=?').run(Number(patch.archived), id);
  if (patch.pinned !== undefined)
    db.prepare('UPDATE sessions SET pinned=? WHERE id=?').run(Number(patch.pinned), id);
}

export function archiveProjectSessions(projectId: string | null): string[] {
  const db = getDatabase();
  const ids = db
    .prepare('SELECT id FROM sessions WHERE project_id IS ? AND archived = 0')
    .all(projectId) as { id: string }[];
  db.prepare('UPDATE sessions SET archived=1 WHERE project_id IS ?').run(projectId);
  return ids.map(({ id }) => id);
}

export async function deleteSession(id: string) {
  const entry = live.get(id);
  if (entry) {
    await entry.session.abort();
    entry.unsubscribe();
    entry.session.dispose();
    live.delete(id);
  }
  const { file } = row(id);
  getDatabase().prepare('DELETE FROM sessions WHERE id=?').run(id);
  if (file && existsSync(file)) {
    const { shell } = await import('electron');
    await shell.trashItem(file).catch(() => {});
  }
}

export function cancelRun(id: string) {
  void live.get(id)?.session.abort();
}

const imageMime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** 一轮对话：用户输入（文字、内联图片、@ 引用路径、文本附件）交给 Pi，Pi 自主决定读什么、做什么。 */
export async function askSession(id: string, input: ChatAskInput): Promise<WorkspaceChat> {
  const entry = await ensureLive(id);
  if (entry.run) throw new Error('请等待当前回答完成');
  const blocks = parseChatBlocks(input.text);
  const userText = stripChatImageTokens(input.text);
  const images: ImageContent[] = [];
  const imageMeta: { id: string; name: string }[] = [];
  for (const block of blocks)
    if (block.type === 'image') {
      const extension = block.name.slice(block.name.lastIndexOf('.') + 1).toLowerCase();
      images.push({
        type: 'image',
        mimeType: imageMime[extension] ?? 'image/png',
        data: readChatMediaBytes(block.id).toString('base64'),
      });
      imageMeta.push({ id: block.id, name: block.name });
    }
  if (!userText && !images.length) throw new Error('请输入内容或添加图片');
  const attachments = input.attachments.map(readChatAttachment);
  // @ 引用即路径：只告诉模型路径，读取由模型用 read 自主完成（pull 模型）。
  const sources = input.context.map((key) => ({ key, title: key }));
  const meta = {
    body: userText,
    ...(sources.length ? { sources } : {}),
    ...(imageMeta.length ? { images: imageMeta } : {}),
    ...(attachments.length ? { attachments: attachments.map(({ name }) => ({ name })) } : {}),
  };
  const prompt = [
    `${META_PREFIX}${JSON.stringify(meta)}${META_SUFFIX}`,
    sources.length
      ? `用户引用了这些文件（需要时用 read 读取）：\n${sources.map((s) => `- ${s.key}`).join('\n')}\n`
      : '',
    ...attachments.map(
      ({ name, bytes }) =>
        `<attachment name="${name}">\n${bytes.toString('utf8')}\n</attachment>\n`,
    ),
    userText,
  ].join('');
  if (input.replaceLastUser) {
    // 编辑重发：从最后一条用户消息之前分支（Pi 会话树保留旧分支）。
    const branch = entry.session.sessionManager.getBranch();
    const lastUser = [...branch]
      .reverse()
      .find((item) => item.type === 'message' && item.message.role === 'user');
    if (!lastUser) throw new Error('没有可编辑的消息');
    if (lastUser.parentId) entry.session.sessionManager.branch(lastUser.parentId);
    else entry.session.sessionManager.resetLeaf();
    entry.session.agent.state.messages =
      entry.session.sessionManager.buildSessionContext().messages;
  }
  const meta0 = row(id);
  if (meta0.title === '新对话')
    getDatabase()
      .prepare('UPDATE sessions SET title=? WHERE id=?')
      .run((userText || '图片请求').slice(0, 60), id);
  entry.run = { id: randomUUID() };
  liveSteps.set(id, new Map());
  runEvent(id, 'running');
  let status: 'completed' | 'failed' | 'stopped' = 'completed';
  try {
    await entry.session.prompt(prompt, images.length ? { images } : undefined);
    const last = entry.session.messages.findLast((m) => m.role === 'assistant');
    if (last?.role === 'assistant' && last.stopReason === 'aborted') status = 'stopped';
    else if (last?.role === 'assistant' && last.stopReason === 'error') status = 'failed';
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    releaseChatAttachments(input.attachments);
    entry.run = undefined;
    liveSteps.delete(id);
    if (entry.session.sessionFile)
      getDatabase()
        .prepare('UPDATE sessions SET file=? WHERE id=?')
        .run(entry.session.sessionFile, id);
    touch(id, entry);
    runEvent(id, status);
    publish(id);
    if (status !== 'stopped') notifyRunFinished(id, status);
    if (entry.stale) {
      entry.unsubscribe();
      entry.session.dispose();
      live.delete(id);
    }
  }
  return snapshot(id);
}
