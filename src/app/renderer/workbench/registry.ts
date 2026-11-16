// 内容类型注册表：TabKind → { 组件, 图标, 标题解析 }；workbench 引用内容标签的唯一入口。
import type { ComponentType } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { Eye, FileText, GitCompare, MessageSquare, SquareTerminal } from 'lucide-react';
import type { TabId, TabKind } from '../../../modules/workspace/contract';
import { ChatTab, ReviewTab, reviewTabTitle, useSessions } from '../../../modules/chat/view';
import { titleOf as entryTitleOf } from '../workspace/entry-dialogs';
import { NoteTab } from '../../../modules/note/view';
import { PreviewTab } from '../../../modules/preview/view';
import { TerminalTab } from '../../../modules/terminal/view';

export interface TabComponentProps {
  tabId: TabId;
  groupId: string;
}

export interface TabDescriptor {
  component: ComponentType<TabComponentProps>;
  icon: ComponentType<{ className?: string }>;
  title: (tabId: TabId, client: QueryClient) => string;
}

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
