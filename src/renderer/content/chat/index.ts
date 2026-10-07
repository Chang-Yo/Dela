// 会话内容域：ChatTab 为标签内容组件，
// 会话身份从 tabId（chat:{sessionId}）解析；引用数据源、邮件草稿弹窗与项目归属
// 经 ChatTabSourceProvider 注入（3B 接 workspace 镜像与 features/mail）。
export { ChatTab, parseChatTabId } from './ChatTab';
export type { ChatReference } from './use-chat';
export {
  ChatTabSourceProvider,
  useChatTabSource,
  type ChatTabSource,
  type MailDraftDialog,
  type MailDraftDialogProps,
  type ReferenceSource,
} from './chat-source';
