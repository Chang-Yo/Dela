// 会话视图类型（拆分自 api.ts）。批次 2B 落地 Session/Run 新身份契约
// （docs/refactor/state-model.md §2.2/§2.3、docs/refactor/decisions-phase1.md 裁决）。
import type { ChatAskInput } from './chat';

export interface AgentToolResult {
  id: string;
  name: string;
  input: unknown;
  /** 执行结果；运行中的占位步骤（startedAt 已有、output 尚缺）没有输出。 */
  output?: unknown;
  /** 本步骤开始执行的 epoch 毫秒；旧会话与更早的记录没有。 */
  startedAt?: number;
  /** 本步骤完成的 epoch 毫秒；运行中或被中断的步骤没有。 */
  finishedAt?: number;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface WorkspaceChat {
  sessionId: string | null;
  running?: boolean;
  activeTool?: string;
  configured: boolean;
  /** 当前使用中的提供商名称；未配置时为 null。 */
  providerName: string | null;
  model: string;
  /** 当前提供商的可选模型，驱动 composer 下拉。 */
  models: string[];
  /** 当前提供商开启的推理强度档位；空数组表示未开启，composer 显示 default 且不可改。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 null。 */
  effort: string | null;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources?: { key: string; title: string }[];
    /** 用户消息携带的内联图片（按输入顺序）；id 对应 chat-media 落盘文件。 */
    images?: { id: string; name: string }[];
    /** 用户消息携带的文本附件名；内容已进入当轮模型上下文，文件不保留。 */
    attachments?: { name: string }[];
    toolResults?: AgentToolResult[];
    /** 按发生顺序保存公开说明、思考过程与相邻工具组；旧会话没有 parts。 */
    parts?: (
      | { type: 'text'; text: string }
      | { type: 'reasoning'; text: string; startedAt?: number; finishedAt?: number }
      | { type: 'tools'; results: AgentToolResult[] }
    )[];
    startedAt?: number;
    finishedAt?: number;
    interrupted?: boolean;
    /** 用户主动停止：保留已生成的部分内容，不追加中断说明文案。 */
    stopped?: boolean;
  }[];
}

/** Run 状态机（state-model.md §2.3）；waiting_input 本轮不触发，interrupted 仅启动时写入。 */
export type RunStatus =
  'pending' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'stopped' | 'interrupted';

/** session:on-run-event 载荷：Run 状态与活跃工具变化。 */
export interface RunEvent {
  sessionId: string;
  runId: string;
  status: RunStatus;
  /** 状态为 running 时的当前工具名；空闲段为 undefined。 */
  activeTool?: string;
}

/** 会话新身份 API（session:* 通道；renderer 阶段三接入，本批仅主进程与 preload 就位）。 */
export interface SessionApi {
  /** 列出会话：projectId 为 null 列通用池；query 按标题或消息原文过滤。 */
  list(projectId: string | null, query?: string): Promise<ChatSessionSummary[]>;
  /** 新建会话（显式身份；空会话会进入历史，由 remove 清理）。 */
  create(projectId: string | null): Promise<WorkspaceChat>;
  /** 打开会话：读取快照，不产生执行。 */
  open(sessionId: string): Promise<WorkspaceChat>;
  /** 删除会话；运行中先中断本轮。 */
  remove(sessionId: string): void;
  /** 发起一轮执行（同 session 串行、跨 session 并行）。 */
  ask(sessionId: string, input: ChatAskInput): Promise<WorkspaceChat>;
  cancelRun(sessionId: string): void;
  /** 会话快照变化推送（sessionId + WorkspaceChat）。 */
  onSessionUpdate(listener: (sessionId: string, chat: WorkspaceChat) => void): () => void;
  /** Run 状态/活跃工具变化推送。 */
  onRunEvent(listener: (event: RunEvent) => void): () => void;
}
