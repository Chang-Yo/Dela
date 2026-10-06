import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

// ChatTab 的容器注入面（与 content/note 的 draft-source、content/preview 的 loader 同一
// 注入模式）：workbench registry 只按 TabComponentProps 传 tabId/groupId，引用数据源、
// 邮件草稿弹窗与项目归属都经 ChatTabSourceProvider 提供（3B 接线）。
// chat 域不 import workspace store——对 workspace 的依赖只经这里的注入接口。

/** @ 引用数据源：候选来自容器（3B 接 workspace 镜像），发送前冲盘未保存的引用草稿。 */
export interface ReferenceSource {
  /** @ 引用候选（打开中的文档优先，其次项目内可读条目）。 */
  loadEntries(): Promise<{ key: string; title: string }[]>;
  /** 发送前冲盘引用文档的未保存草稿（笔记正文先落盘，模型才能读到最新内容）；
   *  仍无法保存时抛错阻止发送。`source:` 前缀的引用不经此方法（只读资料）。 */
  flushReference?(key: string): Promise<void>;
}

/** 邮件草稿检查弹窗：由容器注入（3B 接 features/mail 的 MailComposer）。
 *  组件自包含整个弹窗：读取草稿（mail.openDraft）、账号校验、未保存关闭守卫
 *  （leaveComposer 语义）与发送，全部在组件内完成。 */
export type MailDraftDialogProps = {
  draftId: string;
  /** 仅在关闭守卫通过后调用。 */
  onClose: () => void;
  /** 发送完成回调；warning 为服务端警告文案，无警告为 null。 */
  onSent: (warning: string | null) => void;
};
export type MailDraftDialog = ComponentType<MailDraftDialogProps>;

/** ChatTab 的容器注入面；未挂 Provider 时 ChatTab 按通用池、无引用与邮件注入运行。 */
export interface ChatTabSource {
  /** 会话所属项目；null = 通用池。会话切换条据此列出项目会话与通用入口。 */
  projectId: string | null;
  projects?: { id: string; name: string }[];
  onSelectProject?(projectId: string | null, sessionId: string): Promise<void>;
  /** @ 引用数据源；未提供时 composer 无 @ 候选、发送前不冲盘引用草稿。 */
  referenceSource?: ReferenceSource;
  /** 邮件草稿检查弹窗；未提供时隐藏「检查并发送邮件」入口。 */
  mailDialog?: MailDraftDialog;
  /** 点击消息来源 chip 打开对应文档；未提供时 chip 以纯文本呈现。 */
  onOpenSource?(key: string): void;
  /** 把回答保存为笔记；未提供时隐藏入口。 */
  onSaveNote?(text: string): void;
}

export const ChatTabSourceContext = createContext<ChatTabSource | null>(null);

export function ChatTabSourceProvider({
  source,
  children,
}: {
  source: ChatTabSource;
  children: ReactNode;
}) {
  return <ChatTabSourceContext.Provider value={source}>{children}</ChatTabSourceContext.Provider>;
}

export function useChatTabSource(): ChatTabSource | null {
  return useContext(ChatTabSourceContext);
}
