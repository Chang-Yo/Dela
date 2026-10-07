// 内容类型注册表：TabKind → { 组件, 图标, 标题解析 }。
// workbench 引用 content/ 的唯一入口（structure.md §3.1）。标题解析（3B 接线）同步读取
// workspace/sessions 镜像：条目名 / Canvas 资料名 / 会话标题；镜像变化的即时刷新由
// 装配层（app/workbench-shell）订阅镜像触发重渲染完成。
import { lazy, type ComponentType } from 'react';
import { Eye, FileText, GitCompare, MessageSquare, SquareTerminal } from 'lucide-react';
import type { TabId, TabKind } from '../../shared/layout';
import { useSessions } from '../sessions/store';
import { titleOf as entryTitleOf } from '../workspace/entry-dialogs';

// 内容域懒加载：组件首次渲染时才求值对应模块（TabGroup 渲染处有 Suspense 骨架兜底）。
const ChatTab: ComponentType<TabComponentProps> = lazy(() =>
  import('../content/chat').then((m) => ({ default: m.ChatTab })),
);
const NoteTab: ComponentType<TabComponentProps> = lazy(() =>
  import('../content/note').then((m) => ({ default: m.NoteTab })),
);
const PreviewTab: ComponentType<TabComponentProps> = lazy(() =>
  import('../content/preview').then((m) => ({ default: m.PreviewTab })),
);
const ReviewTab: ComponentType<TabComponentProps> = lazy(() =>
  import('../content/review').then((m) => ({ default: m.ReviewTab })),
);
const TerminalTab: ComponentType<TabComponentProps> = lazy(() =>
  import('../content/terminal/TerminalTab').then((m) => ({ default: m.TerminalTab })),
);

/** 内容组件契约：tabId 定位数据，groupId 用于按组隔离的编辑器会话键（TabId+groupId）。 */
export interface TabComponentProps {
  tabId: TabId;
  groupId: string;
}

export interface TabDescriptor {
  component: ComponentType<TabComponentProps>;
  icon: ComponentType<{ className?: string }>;
  /** 标题解析：条目/资料键查 workspace 镜像，会话键查 sessions 镜像的摘要标题。 */
  title: (tabId: TabId) => string;
}

/** 会话标题：在各池摘要列表里找；列表未载入时给中性的「对话」。 */
function chatTitleOf(sessionId: string): string {
  for (const list of Object.values(useSessions.getState().lists)) {
    const hit = list.find((session) => session.id === sessionId);
    if (hit) return hit.title || '新对话';
  }
  const chat = useSessions.getState().chats[sessionId];
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
    title: (tabId) => entryTitleOf(payloadOf(tabId)),
  },
  preview: {
    component: PreviewTab,
    icon: Eye,
    // preview:source:{id} 的载荷即 source:{id} 文档键，entryTitleOf 直接可用。
    title: (tabId) => entryTitleOf(payloadOf(tabId)),
  },
  review: { component: ReviewTab, icon: GitCompare, title: payloadOf },
  terminal: { component: TerminalTab, icon: SquareTerminal, title: () => 'Terminal' },
};

export function kindOf(tabId: TabId): TabKind {
  return tabId.slice(0, tabId.indexOf(':')) as TabKind;
}

export function titleOf(tabId: TabId): string {
  return registry[kindOf(tabId)].title(tabId);
}

export function iconOf(tabId: TabId): ComponentType<{ className?: string }> {
  return registry[kindOf(tabId)].icon;
}
