// 内容类型注册表：TabKind → { 组件, 图标, 标题解析 }；workbench 引用内容标签的唯一入口。
// 标题解析同步读取 workspace/sessions 镜像；镜像变化的即时刷新由装配层（WorkbenchShell）订阅镜像完成。
import type { ComponentType } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { Eye, FileText, GitCompare, MessageSquare, SquareTerminal } from 'lucide-react';
import type { TabId, TabKind } from '../../shared/layout';
import { ChatTab, ReviewTab, reviewTabTitle, useSessions } from '../../modules/chat/view';
import { titleOf as entryTitleOf } from '../workspace/entry-dialogs';
import { NoteTab } from '../../modules/note/view';
import { PreviewTab } from '../../modules/preview/view';
import { TerminalTab } from '../../modules/terminal/view';

// 聊天、审阅与终端由模块出口懒加载（TabGroup 渲染处有 Suspense 骨架兜底），笔记与预览随外壳静态加载。

/** 内容组件契约：tabId 定位数据，groupId 用于按组隔离的编辑器会话键（TabId+groupId）。 */
export interface TabComponentProps {
  tabId: TabId;
  groupId: string;
}

export interface TabDescriptor {
  component: ComponentType<TabComponentProps>;
  icon: ComponentType<{ className?: string }>;
  /** 标题解析：条目键查 workspace 镜像，资料键查模块查询缓存，会话键查 sessions 镜像。 */
  title: (tabId: TabId, client: QueryClient) => string;
}

/** 会话标题：在各池摘要列表里找；列表未载入时给中性的「对话」。 */
function chatTitleOf(sessionId: string): string {
  for (const list of Object.values(useSessions.getState().lists)) {
    const hit = list.find((session) => session.id === sessionId);
    if (hit) return hit.title || '新对话';
  }
  const chat = useSessions.getState().chats[sessionId];
  if (chat?.subagent) return chat.subagent.description;
  return chat && chat.messages.length === 0 ? '新对话' : '对话';
}

const payloadOf = (tabId: TabId) => tabId.slice(tabId.indexOf(':') + 1);

export const registry: Record<TabKind, TabDescriptor> = {
  chat: {
    component: ChatTab,
    icon: MessageSquare,
    title: (tabId) => chatTitleOf(payloadOf(tabId)),
  },
  note: {
    component: NoteTab,
    icon: FileText,
    title: (tabId, client) => entryTitleOf(payloadOf(tabId), client),
  },
  preview: {
    component: PreviewTab,
    icon: Eye,
    // preview:source:{id} 的载荷即 source:{id} 文档键，entryTitleOf 直接可用。
    title: (tabId, client) => entryTitleOf(payloadOf(tabId), client),
  },
  review: { component: ReviewTab, icon: GitCompare, title: reviewTabTitle },
  terminal: { component: TerminalTab, icon: SquareTerminal, title: () => 'Terminal' },
};

export function kindOf(tabId: TabId): TabKind {
  return tabId.slice(0, tabId.indexOf(':')) as TabKind;
}

export function titleOf(tabId: TabId, client: QueryClient): string {
  return registry[kindOf(tabId)].title(tabId, client);
}

export function iconOf(tabId: TabId): ComponentType<{ className?: string }> {
  return registry[kindOf(tabId)].icon;
}
