// 会话视图类型（机械拆分自 api.ts）。SessionApi/RunEvent 新契约与 WorkspaceChat → SessionView
// 的语义重整按 docs/refactor/structure.md §4 由批次 2B 落地，本文件先承接现状类型。

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
