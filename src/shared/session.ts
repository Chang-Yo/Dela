// 会话视图类型：协议里的部分由 core/protocol/agent 的 schema 推导，这里只放桌面端自己的。
export type {
  AgentToolOutput,
  AgentToolResult,
  BackgroundTaskView,
  ChatQueueEvent,
  ChatScope,
  ChatSessionSummary,
  ChatStreamEvent,
  ContextUsageView,
  MainSessionCommand,
  RunEvent,
  RunStatus,
  SessionCommandName,
  SidechatView,
  SubagentDetails,
  TaskNoticeDetails,
  TaskStatus,
  WorkspaceChat,
} from '../core/protocol/agent';
export { SESSION_COMMANDS, parseSessionCommand } from '../core/protocol/agent';
