// 会话视图类型：WorkspaceChat 是 Pi 会话消息的投影（main/agent/session.ts）。
import type { ChatAskInput, ChatComment } from './chat';

/** Pi 工具结果的投影：text 是回灌给模型的文本，details 是工具的结构化细节（edit 的 diff 等），
 *  image 是工具回图给模型时的图片本体（read 读图片），供轨迹预览，base64 随消息投影。 */
export interface AgentToolOutput {
  text: string;
  details?: unknown;
  isError?: boolean;
  image?: { mimeType: string; data: string };
}

export interface AgentToolResult {
  id: string;
  name: string;
  input: unknown;
  /** 执行结果；运行中的步骤只有流式部分输出（或尚无输出）。 */
  output?: AgentToolOutput;
  /** 本步骤开始执行的 epoch 毫秒；旧会话与更早的记录没有。 */
  startedAt?: number;
  /** 本步骤完成的 epoch 毫秒；运行中或被中断的步骤没有。 */
  finishedAt?: number;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  projectId?: string | null;
}

/** percent 为 0–100 百分数；tokens null = 暂不可知（如压缩后、Pi 也没给出估计）。
 *  inputTokens / cachedTokens 是本会话累计用量（Pi SessionStats.tokens 的 input / cacheRead，
 *  含已被压缩掉的历史），仅在提供商确实上报过缓存时才带上，见 main/agent/session.ts 的 usageOf。 */
export interface ContextUsageView {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  /** 压缩后、模型还没回复前的估计值（Pi 的 estimatedTokensAfter）；下一次回复后换成实际用量。 */
  estimated?: boolean;
  /** 本会话累计输入 token（不含缓存读取）。 */
  inputTokens?: number;
  /** 本会话累计缓存读取 token；与 inputTokens 同时出现。 */
  cachedTokens?: number;
}

export interface WorkspaceChat {
  sessionId: string | null;
  /** 会话所属项目（workspace 条目 id）；null = 通用会话。归属在创建时确定，不随视图变化。 */
  projectId: string | null;
  /** 会话 cwd（会话私有目录、项目目录或工作区根）：@ 引用以它为相对路径基准。 */
  cwd: string | null;
  running?: boolean;
  activeTool?: string;
  /** 上下文压缩进行中（低干扰状态，压缩期间短暂为 true）。 */
  compacting?: boolean;
  /** 至少有一个启用且带密钥的提供商。 */
  configured: boolean;
  /** 会话的模型选择；从未选择过的会话沿用最近发过消息的会话。 */
  providerId: string | null;
  providerName: string | null;
  model: string;
  /** 会话选中的提供商被停用、删除或移除了该模型：保留选择但不能发送，需在会话里另选。 */
  modelUnavailable: boolean;
  /** 当前模型开启的推理强度档位；空数组表示未配置，composer 显示 default 并提供设置入口。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 null。 */
  effort: string | null;
  contextUsage?: ContextUsageView | null;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources?: { key: string; title: string }[];
    /** 用户消息携带的内联图片（按输入顺序）；id 对应 chat-media 落盘文件。 */
    images?: { id: string; name: string }[];
    /** 用户消息携带的文本附件名；内容已进入当轮模型上下文，文件不保留。 */
    attachments?: { name: string }[];
    /** 用户消息携带的回复评论（按添加顺序）。 */
    comments?: ChatComment[];
    toolResults?: AgentToolResult[];
    /** 按发生顺序保存公开说明、思考过程与相邻工具组；旧会话没有 parts。 */
    parts?: (
      | { type: 'text'; text: string }
      | { type: 'reasoning'; text: string; startedAt?: number; finishedAt?: number }
      | { type: 'tools'; results: AgentToolResult[] }
    )[];
    startedAt?: number;
    /** 对应冻结的本轮 diff；旧消息无此字段。 */
    turnId?: string;
    /** 已完成回复的最后一个会话记录条目：从这里分支会话。运行中的回复没有。 */
    entryId?: string;
    finishedAt?: number;
    interrupted?: boolean;
    /** 用户主动停止：保留已生成的部分内容，不追加中断说明文案。 */
    stopped?: boolean;
    compacted?: boolean;
    /** Pi 扩展经 sendMessage 发出、标了 display 的消息（role 固定为 assistant 一侧展示）。 */
    extension?: { customType: string };
  }[];
}

/** Run 状态机；waiting_input 本轮不触发，interrupted 仅启动时写入。 */
export type RunStatus =
  'pending' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'stopped' | 'interrupted';

export interface RunEvent {
  sessionId: string;
  runId: string;
  status: RunStatus;
  /** 状态为 running 时的当前工具名；空闲段为 undefined。 */
  activeTool?: string;
  /** 冻结 diff 落盘失败；不改变 Agent 执行本身的完成状态。 */
  changesError?: string;
}

/** session:on-stream 载荷：流式增量只携带本轮正在生成的末条 assistant 消息，
 *  渲染端合并进已缓存快照——全量历史广播的代价随会话长度线性放大，流式期每
 *  ~100ms 一次会导致 IPC 巨包与渲染端整线程重渲。工具图片只在工具结束的全量
 *  快照里下发，增量不带 image，渲染端按 toolCallId 从旧消息回填。 */
export interface ChatStreamEvent {
  sessionId: string;
  message: WorkspaceChat['messages'][number];
  /** 当前执行中的工具名；空闲段为 undefined。 */
  activeTool?: string;
  contextUsage?: ContextUsageView | null;
}

/** 旁问快照：messages 只含旁问自己的提问与回复，借来的主会话历史不重复下发。 */
export interface SidechatView {
  parentId: string;
  running: boolean;
  activeTool?: string;
  messages: WorkspaceChat['messages'];
}

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

/** 通用会话的工作目录归属：'chat' = 首页随聊的私有目录，'library' = 资料页的课程目录。
 *  项目会话（projectId 非空）由项目目录决定 cwd，忽略 scope。 */
export type ChatScope = 'chat' | 'library';

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
  /** 永久删除已归档会话；运行中先中断本轮，仅设置中的管理入口调用。 */
  remove(sessionId: string): Promise<void>;
  /** 发起一轮执行（同 session 串行、跨 session 并行）。 */
  ask(sessionId: string, input: ChatAskInput): Promise<WorkspaceChat>;
  cancelRun(sessionId: string): void;
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
}
