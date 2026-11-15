import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Navigate, Workbench } from '../../../app/module';

// ChatTab 的容器注入面（与 note 的 draft-source、preview 的 loader 同一注入模式）：workbench 只传
// tabId/groupId，引用数据源与邮件草稿弹窗经 Provider 注入；会话项目归属取自快照而非当前工作台。
// chat 域不 import workspace store。

/** @ 引用数据源：候选来自容器（workspace 镜像），发送前冲盘未保存的引用草稿。 */
export interface ReferenceSource {
  /** 会话项目内的 @ 引用候选：key 为绝对路径，title 为相对会话 cwd 的路径。
   *  projectId 为 null 时列工作区全部文件。 */
  useEntries(projectId: string | null, cwd: string | null): { key: string; title: string }[];
  /** 发送前冲盘引用文档的未保存草稿（笔记正文先落盘，模型才能读到最新内容）；
   *  仍无法保存时抛错阻止发送。`source:` 前缀的引用不经此方法（只读资料）。 */
  flushReference?(key: string): Promise<void>;
}

/** 邮件草稿检查弹窗：由容器注入；读取草稿、账号校验、未保存关闭守卫与发送都在组件内完成。 */
export type MailDraftDialogProps = {
  draftId: string;
  /** 仅在关闭守卫通过后调用。 */
  onClose: () => void;
  /** 发送完成回调；warning 为服务端警告文案，无警告为 null。 */
  onSent: (warning: string | null) => void;
};
export type MailDraftDialog = ComponentType<MailDraftDialogProps>;

/** ChatTab 的容器注入面；未挂 Provider 时无引用与邮件注入，跳转与开标签不生效。 */
export interface ChatTabSource {
  navigate: Navigate;
  workbench: Workbench;
  /** 应用内会打开的链接，点击时免去外链确认。 */
  opensLink(url: string): boolean;
  /** @ 引用数据源；未提供时 composer 无 @ 候选、发送前不冲盘引用草稿。 */
  referenceSource?: ReferenceSource;
  /** 邮件草稿检查弹窗；未提供时隐藏「检查并发送邮件」入口。 */
  mailDialog?: MailDraftDialog;
  /** 把回答保存为笔记；未提供时隐藏入口。 */
  onSaveNote?(text: string): void;
}

const detached: ChatTabSource = {
  navigate: () => false,
  workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
  opensLink: () => false,
};

export const ChatTabSourceContext = createContext<ChatTabSource>(detached);

export function ChatTabSourceProvider({
  source,
  children,
}: {
  source: ChatTabSource;
  children: ReactNode;
}) {
  return <ChatTabSourceContext.Provider value={source}>{children}</ChatTabSourceContext.Provider>;
}

export function useChatTabSource(): ChatTabSource {
  return useContext(ChatTabSourceContext);
}
