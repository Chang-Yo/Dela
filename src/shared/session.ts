// 会话视图类型：协议里的部分由 core/protocol/agent 的 schema 推导，这里只放桌面端自己的。
import type {
  ChatAskInput,
  ChatQueueEvent,
  ChatQueuedDraft,
  ChatScope,
  ChatSessionSummary,
  ChatStreamEvent,
  RunEvent,
  SidechatView,
  TaskStatus,
  WorkspaceChat,
} from '../core/protocol/agent';

export type {
  AgentToolOutput,
  AgentToolResult,
  BackgroundTaskView,
  ChatQueueEvent,
  ChatScope,
  ChatSessionSummary,
  ChatStreamEvent,
  ContextUsageView,
  RunEvent,
  RunStatus,
  SidechatView,
  TaskNoticeDetails,
  TaskStatus,
  WorkspaceChat,
} from '../core/protocol/agent';

/** task 工具（子 Agent）结果的 details：taskId 即子会话 id；运行中带当前步骤。 */
export interface SubagentDetails {
  taskId: string;
  status: TaskStatus;
  steps: number;
  tool?: { name: string; target: string };
  reply?: string | null;
  background?: true;
}

/** 后台任务通知在 Pi 会话记录里的 customType。 */
export const TASK_NOTICE = 'dela-task';

/** 旁问（sidechat:* 通道）：以主会话 id 寻址，每个主会话最多一个，不入库、关闭即丢弃。 */
export interface SidechatApi {
  open(parentId: string): Promise<SidechatView>;
  ask(parentId: string, input: ChatAskInput): Promise<SidechatView>;
  cancel(parentId: string): void;
  close(parentId: string): Promise<void>;
  /** 保留为新会话（「旁问：」前缀），返回新会话快照；旁问随之关闭。 */
  keep(parentId: string): Promise<WorkspaceChat>;
  onUpdate(listener: (view: SidechatView) => void): () => void;
  /** 流式增量，sessionId 是主会话 id。 */
  onStream(listener: (event: ChatStreamEvent) => void): () => void;
  onClosed(listener: (parentId: string) => void): () => void;
}

/** 会话身份 API（session:* 通道）。 */
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

export interface SessionApi {
  archived(): Promise<ChatSessionSummary[]>;
  update(sessionId: string, patch: { archived?: boolean; pinned?: boolean }): Promise<void>;
  archiveProject(projectId: string | null): Promise<string[]>;
  /** 列出会话：projectId 为 null 列通用池；query 按标题或消息原文过滤。 */
  list(projectId: string | null, query?: string): Promise<ChatSessionSummary[]>;
  /** 复用所属项目的空会话；空会话不进入历史。 */
  create(projectId: string | null, scope: ChatScope): Promise<WorkspaceChat>;
  /** 打开会话：读取快照，不产生执行。 */
  open(sessionId: string): Promise<WorkspaceChat>;
  export(sessionId: string): Promise<{ saved: boolean; missing: string[] }>;
  /** 永久删除已归档会话；运行中先中断本轮，仅设置中的管理入口调用。 */
  remove(sessionId: string): Promise<void>;
  /** 发起一轮执行（同 session 串行、跨 session 并行）；运行中发送即插队。 */
  ask(sessionId: string, input: ChatAskInput): Promise<WorkspaceChat>;
  /** 停止本轮；还没送达的插队消息一并撤回，供回填输入框。 */
  cancelRun(sessionId: string): Promise<ChatQueuedDraft | null>;
  /** 撤回全部还没送达的插队消息；没有时为 null。 */
  withdrawQueued(sessionId: string): Promise<ChatQueuedDraft | null>;
  /** 用户在后台任务面板上停止一个任务：通知只追加进记录，不唤醒会话。 */
  stopTask(sessionId: string, taskId: string): Promise<void>;
  /** 执行一条会话命令（/compact、/reload、/name），返回执行后的快照；/compact 运行中可用 cancelRun 取消。 */
  runCommand(sessionId: string, name: MainSessionCommand, args: string): Promise<WorkspaceChat>;
  /** 从这条回复分出新会话（「分支：」前缀，沿用项目与模型），原会话不变。 */
  fork(sessionId: string, entryId: string): Promise<WorkspaceChat>;
  /** 只改这个会话的模型；运行中的一轮照旧用原模型，下一轮生效。 */
  setModel(sessionId: string, providerId: string, model: string): Promise<WorkspaceChat>;
  setEffort(sessionId: string, level: string): Promise<WorkspaceChat>;
  onSessionUpdate(listener: (sessionId: string, chat: WorkspaceChat) => void): () => void;
  /** 流式增量推送（仅末条 assistant 消息）：合并进镜像缓存，不广播全量历史。 */
  onStream(listener: (event: ChatStreamEvent) => void): () => void;
  onRunEvent(listener: (event: RunEvent) => void): () => void;
  onQueue(listener: (event: ChatQueueEvent) => void): () => void;
}
