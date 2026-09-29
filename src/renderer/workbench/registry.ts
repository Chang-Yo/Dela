// 内容类型注册表：TabKind → { 组件, 图标, 标题解析 }。
// workbench 引用 content/ 的唯一入口（structure.md §3.1）；本批内容组件为占位，
// 批次 3B 替换 content/*/index.ts 为真实现（导出名与 props 契约不变）。
import type { ComponentType } from 'react';
import { Eye, FileText, GitCompare, MessageSquare } from 'lucide-react';
import type { TabId, TabKind } from '../../shared/layout';
import { ChatTab } from '../content/chat';
import { NoteTab } from '../content/note';
import { PreviewTab } from '../content/preview';
import { ReviewTab } from '../content/review';

/** 内容组件契约：tabId 定位数据，groupId 用于按组隔离的编辑器会话键（TabId+groupId）。 */
export interface TabComponentProps {
  tabId: TabId;
  groupId: string;
}

export interface TabDescriptor {
  component: ComponentType<TabComponentProps>;
  icon: ComponentType<{ className?: string }>;
  /** 标题解析；本批返回 TabId 短串，3B 接 workspace/sessions 镜像后返回真实名称。 */
  title: (tabId: TabId) => string;
}

const shortTitle = (tabId: TabId) => tabId.slice(tabId.indexOf(':') + 1);

export const registry: Record<TabKind, TabDescriptor> = {
  chat: { component: ChatTab, icon: MessageSquare, title: shortTitle },
  note: { component: NoteTab, icon: FileText, title: shortTitle },
  preview: { component: PreviewTab, icon: Eye, title: shortTitle },
  review: { component: ReviewTab, icon: GitCompare, title: shortTitle },
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
