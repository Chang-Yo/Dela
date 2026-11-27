import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { ChatReplyActions, Navigate, Workbench } from '../../../app/module';

// ChatTab 的容器注入面（与 note 的 draft-source、preview 的 loader 同一模式）：workbench 只传 tabId/groupId，
// 引用数据源与各模块登记的回复操作经 Provider 注入；chat 域不 import workspace store。

/** @ 引用候选：key 为绝对路径，title 为相对会话 cwd 的路径。 */
export type ReferenceEntry = { key: string; title: string };

export interface ReferenceSource {
  /** 订阅会话项目内的候选交给 children；projectId 为 null 时列工作区全部文件。
   *  以组件而非 hook 注入：编译器不接手调用经 props 传入的 hook 的组件。 */
  Entries: ComponentType<{
    projectId: string | null;
    cwd: string | null;
    children: (entries: ReferenceEntry[]) => ReactNode;
  }>;
  /** 发送前冲盘引用文档的未保存草稿（笔记正文先落盘，模型才能读到最新内容）；
   *  仍无法保存时抛错阻止发送。`source:` 前缀的引用不经此方法（只读资料）。 */
  flushReference?(key: string): Promise<void>;
}

export interface ChatTabSource {
  navigate: Navigate;
  workbench: Workbench;
  /** 应用内会打开的链接，点击时免去外链确认。 */
  opensLink(url: string): boolean;
  /** 各模块登记的回复操作，渲染在每条助手回复的正文之后。 */
  replyActions: ChatReplyActions[];
  /** @ 引用数据源；未提供时 composer 无 @ 候选、发送前不冲盘引用草稿。 */
  referenceSource?: ReferenceSource;
  onSaveNote?(text: string): void;
}

const noEntries: ReferenceEntry[] = [];
export function NoReferenceEntries({
  children,
}: {
  children: (entries: ReferenceEntry[]) => ReactNode;
}) {
  return children(noEntries);
}

const detached: ChatTabSource = {
  navigate: () => false,
  workbench: { open: () => {}, openDocument: () => {}, close: () => {} },
  opensLink: () => false,
  replyActions: [],
};

const ChatTabSourceContext = createContext<ChatTabSource>(detached);

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
