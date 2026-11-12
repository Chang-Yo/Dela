// Agent 协议：桌面界面与移动端共用的唯一对外契约，只做向后兼容的新增（AD-5）。
// 默认单用户：任一端都可以取消或撤回，事件推给所有端，重连时重取快照即可。
import { z } from 'zod';
import { defineContract } from './contract';

/** 不兼容的改动才升主版本；握手时主版本不同就拒绝连接。 */
export const AGENT_PROTOCOL_VERSION = 1;

const uuid = z.string().uuid();
const sessionId = uuid;
const projectId = uuid.nullable();

export const chatScopeSchema = z.enum(['chat', 'library']);

export const chatCommentSchema = z.object({
  quote: z.string().trim().min(1).max(20000),
  comment: z.string().max(20000),
});

/** 会话、附件与引用都按值传；@ 引用是本机路径，# 引用是同项目会话。 */
export const chatAskInputSchema = z.object({
  text: z.string().max(20000),
  attachments: z.array(uuid).max(5),
  context: z.array(z.string().max(32_767)),
  sessions: z.array(z.object({ id: uuid, title: z.string().max(500) })).optional(),
  comments: z.array(chatCommentSchema),
  /** 编辑重发：丢弃最后一条用户消息及其后内容。 */
  replaceLastUser: z.boolean().optional(),
});

export const chatMediaViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  kind: z.enum(['image', 'attachment']),
  previewUrl: z.string().nullable(),
});

export const chatQueuedDraftSchema = z.object({
  text: z.string(),
  comments: z.array(chatCommentSchema),
  attachments: z.array(chatMediaViewSchema),
});

export const chatCommandViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
});

export const agentToolOutputSchema = z.object({
  text: z.string(),
  details: z.unknown().optional(),
  isError: z.boolean().optional(),
  image: z.object({ mimeType: z.string(), data: z.string() }).optional(),
});

export const agentToolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  output: agentToolOutputSchema.optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
});

export const taskStatusSchema = z.enum(['running', 'completed', 'failed', 'stopped']);

export const taskNoticeDetailsSchema = z.object({
  taskId: z.string(),
  kind: z.enum(['bash', 'subagent']),
  label: z.string(),
  status: taskStatusSchema.exclude(['running']),
  exitCode: z.number().optional(),
  durationMs: z.number(),
  noticeId: z.string(),
  turnId: z.string().optional(),
});

export const backgroundTaskViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['bash', 'subagent']),
  label: z.string(),
  startedAt: z.number(),
});

export const chatSessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
  pinned: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
});

/** tokens 为 null 表示暂不可知；inputTokens 与 cachedTokens 只在提供商上报缓存时出现。 */
export const contextUsageViewSchema = z.object({
  tokens: z.number().nullable(),
  contextWindow: z.number(),
  percent: z.number().nullable(),
  estimated: z.boolean().optional(),
  inputTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
});

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  sources: z.array(z.object({ key: z.string(), title: z.string() })).optional(),
  sessions: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  images: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  attachments: z.array(z.object({ name: z.string() })).optional(),
  comments: z.array(chatCommentSchema).optional(),
  toolResults: z.array(agentToolResultSchema).optional(),
  parts: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({
          type: z.literal('reasoning'),
          text: z.string(),
          startedAt: z.number().optional(),
          finishedAt: z.number().optional(),
        }),
        z.object({ type: z.literal('tools'), results: z.array(agentToolResultSchema) }),
      ]),
    )
    .optional(),
  startedAt: z.number().optional(),
  turnId: z.string().optional(),
  /** 已完成回复的最后一个记录条目，fork 从这里分支。 */
  entryId: z.string().optional(),
  finishedAt: z.number().optional(),
  interrupted: z.boolean().optional(),
  stopped: z.boolean().optional(),
  compacted: z.boolean().optional(),
  extension: z.object({ customType: z.string() }).optional(),
  task: taskNoticeDetailsSchema.optional(),
});

/** 会话快照：重连或错过事件时以它为准。 */
export const workspaceChatSchema = z.object({
  sessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  cwd: z.string().nullable(),
  running: z.boolean().optional(),
  activeTool: z.string().optional(),
  compacting: z.boolean().optional(),
  queued: z.array(z.string()).optional(),
  tasks: z.array(backgroundTaskViewSchema).optional(),
  subagent: z.object({ parentId: z.string(), description: z.string() }).optional(),
  /** 至少有一个启用且带密钥的提供商。 */
  configured: z.boolean(),
  providerId: z.string().nullable(),
  providerName: z.string().nullable(),
  model: z.string(),
  /** 选中的模型已不可用：保留选择但不能发送。 */
  modelUnavailable: z.boolean(),
  effortLevels: z.array(z.string()),
  effort: z.string().nullable(),
  contextUsage: contextUsageViewSchema.nullable().optional(),
  messages: z.array(chatMessageSchema),
});

export const runStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'stopped',
  'interrupted',
]);

export const runEventSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  status: runStatusSchema,
  activeTool: z.string().optional(),
  /** 冻结 diff 落盘失败，不影响本轮的完成状态。 */
  changesError: z.string().optional(),
});

/** 流式事件只带正在生成的末条消息，整条覆盖，不是文本增量。 */
export const chatStreamEventSchema = z.object({
  sessionId: z.string(),
  message: chatMessageSchema,
  activeTool: z.string().optional(),
  contextUsage: contextUsageViewSchema.nullable().optional(),
});

export const chatQueueEventSchema = z.object({
  sessionId: z.string(),
  queued: z.array(z.string()),
});

/** 旁问只含自己的问答，借来的主会话历史不重复下发。 */
export const sidechatViewSchema = z.object({
  parentId: z.string(),
  running: z.boolean(),
  activeTool: z.string().optional(),
  messages: z.array(chatMessageSchema),
});

export const fileChangeSummarySchema = z.object({
  /** 相对本次比较目录的路径，统一用 /。 */
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
  beforeBytes: z.number().nullable(),
  afterBytes: z.number().nullable(),
  textDiff: z.boolean(),
  stat: z.object({ added: z.number(), deleted: z.number() }).nullable().optional(),
});

export const fileChangeDetailSchema = fileChangeSummarySchema.extend({
  before: z.string().nullable(),
  after: z.string().nullable(),
  patch: z.string().nullable(),
  note: z.string().nullable(),
});

export const turnChangesSchema = z.object({
  turnId: z.string(),
  cwd: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  runStatus: z.enum(['completed', 'failed', 'stopped']),
  state: z.enum(['complete', 'partial', 'unavailable']),
  warnings: z.array(z.string()),
  files: z.array(fileChangeSummarySchema),
});

/** 可供会话选用的模型；提供商的配置只在桌面端进行。 */
export const modelProviderViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(z.string()),
});

export type ChatComment = z.infer<typeof chatCommentSchema>;
export type ChatAskInput = z.infer<typeof chatAskInputSchema>;
export type ChatMediaView = z.infer<typeof chatMediaViewSchema>;
export type ChatQueuedDraft = z.infer<typeof chatQueuedDraftSchema>;
export type ChatCommandView = z.infer<typeof chatCommandViewSchema>;
export type FileChangeSummary = z.infer<typeof fileChangeSummarySchema>;
export type FileChangeDetail = z.infer<typeof fileChangeDetailSchema>;
export type TurnChanges = z.infer<typeof turnChangesSchema>;
export type AgentToolOutput = z.infer<typeof agentToolOutputSchema>;
export type AgentToolResult = z.infer<typeof agentToolResultSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskNoticeDetails = z.infer<typeof taskNoticeDetailsSchema>;
export type BackgroundTaskView = z.infer<typeof backgroundTaskViewSchema>;
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;
export type ContextUsageView = z.infer<typeof contextUsageViewSchema>;
export type WorkspaceChat = z.infer<typeof workspaceChatSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
export type ChatQueueEvent = z.infer<typeof chatQueueEventSchema>;
export type SidechatView = z.infer<typeof sidechatViewSchema>;
/** 'chat' 是首页随聊的私有目录，'library' 是资料页的课程目录；项目会话忽略它。 */
export type ChatScope = z.infer<typeof chatScopeSchema>;

/** task 工具（子 Agent）结果的 details：taskId 即子会话 id；运行中带当前步骤。 */
export interface SubagentDetails {
  taskId: string;
  status: TaskStatus;
  steps: number;
  tool?: { name: string; target: string };
  reply?: string | null;
  background?: true;
}

/**
 * Dela 自己实现的会话命令，对应 Pi 终端界面里的同名命令（Pi 的 SDK 不带这些命令）。输入以它们开头时
 * 不发给模型，也不经过扩展命令与提示模板：Dela 命令 > 扩展命令 > 提示模板 > 普通消息，与 Pi 一致。
 */
export const SESSION_COMMANDS = [
  { name: 'compact', description: '压缩上下文', argumentHint: '[压缩时的说明]' },
  { name: 'reload', description: '重新加载 Skills、扩展与 AGENTS.md' },
  { name: 'name', description: '重命名对话', argumentHint: '<标题>' },
  { name: 'new', description: '新对话' },
  {
    name: 'btw',
    description: '旁问：带着当前对话顺便问一句，不进入主对话',
    argumentHint: '[问题]',
  },
] as const;

export type SessionCommandName = (typeof SESSION_COMMANDS)[number]['name'];

/** `/new` 与 `/btw` 只是界面动作，由渲染端处理；其余在主进程执行。 */
export type MainSessionCommand = Exclude<SessionCommandName, 'new' | 'btw'>;

/** 输入是不是一条会话命令：命令名后要么结束、要么是空白再跟参数（`/compactor` 不算）。 */
export function parseSessionCommand(
  text: string,
): { name: SessionCommandName; args: string } | null {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const name = SESSION_COMMANDS.find((command) => command.name === match?.[1])?.name;
  return name ? { name, args: match?.[2]?.trim() ?? '' } : null;
}

const filePath = z.string().min(1).max(32_767);
const empty = z.object({});
const sidechatTarget = z.object({ parentId: uuid });

export const agentContract = defineContract('agent', {
  handshake: {
    input: z.object({ protocolVersion: z.number().int() }),
    output: z.object({ protocolVersion: z.number().int() }),
  },
  'list-sessions': {
    input: z.object({ projectId, query: z.string().max(200).default('') }),
    output: z.array(chatSessionSummarySchema),
  },
  'create-session': {
    input: z.object({ projectId, scope: chatScopeSchema }),
    output: workspaceChatSchema,
  },
  'open-session': { input: z.object({ sessionId }), output: workspaceChatSchema },
  /** 运行中发送即插队。 */
  ask: {
    input: chatAskInputSchema.extend({ sessionId }),
    output: workspaceChatSchema,
  },
  /** 停止本轮，未送达的插队消息一并撤回。 */
  'cancel-run': { input: z.object({ sessionId }), output: chatQueuedDraftSchema.nullable() },
  'withdraw-queued': { input: z.object({ sessionId }), output: chatQueuedDraftSchema.nullable() },
  'stop-task': { input: z.object({ sessionId, taskId: uuid }), output: z.void() },
  fork: {
    input: z.object({ sessionId, entryId: z.string().min(1).max(64) }),
    output: workspaceChatSchema,
  },
  'list-models': { input: empty, output: z.array(modelProviderViewSchema) },
  'set-model': {
    input: z.object({ sessionId, providerId: uuid, model: z.string().min(1).max(200) }),
    output: workspaceChatSchema,
  },
  'set-effort': {
    input: z.object({ sessionId, level: z.string().min(1).max(16) }),
    output: workspaceChatSchema,
  },
  'list-commands': { input: empty, output: z.array(chatCommandViewSchema) },
  'run-command': {
    input: z.object({
      sessionId,
      name: z.enum(['compact', 'reload', 'name']),
      args: z.string().max(2000),
    }),
    output: workspaceChatSchema,
  },
  'open-sidechat': { input: sidechatTarget, output: sidechatViewSchema },
  'ask-sidechat': {
    input: chatAskInputSchema.omit({ replaceLastUser: true }).extend({ parentId: uuid }),
    output: sidechatViewSchema,
  },
  'cancel-sidechat': { input: sidechatTarget, output: z.void() },
  'close-sidechat': { input: sidechatTarget, output: z.void() },
  /** 把旁问保留为新会话，旁问随之关闭。 */
  'keep-sidechat': { input: sidechatTarget, output: workspaceChatSchema },
  'stage-media': {
    input: z.object({
      name: z.string().min(1).max(255),
      bytes: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
    }),
    output: chatMediaViewSchema,
  },
  'read-media-preview': { input: z.object({ id: uuid }), output: z.string().nullable() },
  'release-media': { input: z.object({ ids: z.array(uuid).max(24) }), output: z.void() },
  'list-turn-changes': { input: z.object({ sessionId }), output: z.array(turnChangesSchema) },
  'read-turn-changes': {
    input: z.object({ sessionId, turnId: uuid, includeStats: z.boolean().optional() }),
    output: turnChangesSchema.nullable(),
  },
  'read-turn-file-change': {
    input: z.object({ sessionId, turnId: uuid, path: filePath }),
    output: fileChangeDetailSchema,
  },
});

/** 服务端推送的事件，推给所有已连接的端。 */
export const agentEvents = {
  'session-update': z.object({ sessionId: z.string(), chat: workspaceChatSchema }),
  'session-stream': chatStreamEventSchema,
  'run-event': runEventSchema,
  queue: chatQueueEventSchema,
  'sidechat-update': sidechatViewSchema,
  'sidechat-stream': chatStreamEventSchema,
  'sidechat-closed': z.object({ parentId: z.string() }),
};
