// 扁平标签栏：组内拖拽排序、跨组拖放、中键关闭、上下文菜单、激活滚动可见。
import { useEffect, useRef, type DragEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { GroupNode, TabId } from '../../../modules/workspace/contract';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../../ui/context-menu';
import { cn } from '../../../ui/lib/cn';
import { useHorizontalWheel } from '../../../ui/hooks/use-horizontal-wheel';
import { useWorkbenchLayout } from './layout-store';
import { iconOf, titleOf } from './registry';
import { ExplorerRevealButton } from './explorer-state';
import { encodeTabDrag, hasTabDrag, parseTabDrag, setCurrentTabDrag, tabDragType } from './tab-dnd';
import { GroupToolbar } from './GroupToolbar';
import { IconButton } from '../../../ui/icon-button';

export function TabBar({
  group,
  unfocused,
  showReveal,
}: {
  group: GroupNode;
  unfocused: boolean;
  showReveal: boolean;
}) {
  const queryClient = useQueryClient();
  const openTab = useWorkbenchLayout((s) => s.openTab);
  const closeTab = useWorkbenchLayout((s) => s.closeTab);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const togglePin = useWorkbenchLayout((s) => s.togglePin);
  const keepTab = useWorkbenchLayout((s) => s.keepTab);
  const listRef = useHorizontalWheel<HTMLDivElement>();
  const tabRefs = useRef(new Map<TabId, HTMLDivElement>());

  useEffect(() => {
    if (!group.active) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [group.active]);

  const setTabRef = (tab: TabId) => (element: HTMLDivElement | null) => {
    if (element) tabRefs.current.set(tab, element);
    else tabRefs.current.delete(tab);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tab: TabId) => {
    if (event.target !== event.currentTarget) return;
    const index = group.tabs.indexOf(tab);
    let targetIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        targetIndex = (index - 1 + group.tabs.length) % group.tabs.length;
        break;
      case 'ArrowRight':
        targetIndex = (index + 1) % group.tabs.length;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = group.tabs.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        openTab(tab, group.id);
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = group.tabs[targetIndex]!;
    openTab(target, group.id);
    tabRefs.current.get(target)?.focus();
  };

  // 标签栏自身的拖放先于组处理（排序优先于入组/分屏），两个回调都 stopPropagation。
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = parseTabDrag(event.dataTransfer.getData(tabDragType));
    setCurrentTabDrag(null);
    if (!payload) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    let index = group.tabs.length;
    if (target) {
      const tab = target.dataset.tab as TabId;
      index = Math.max(0, group.tabs.indexOf(tab));
      const rect = target.getBoundingClientRect();
      if (event.clientX > rect.left + rect.width / 2) index += 1;
    }
    moveTab(payload.tabId, payload.fromGroup, group.id, index);
  };

  const activeTab = group.active;
  if (!group.tabs.length) return null;

  return (
    <div className="@container flex h-10 min-w-0 shrink-0 bg-surface px-2 pt-1">
      {showReveal && <ExplorerRevealButton className="mb-1 self-end" />}
      <div
        ref={listRef}
        role="tablist"
        aria-label={activeTab ? `标签页：${titleOf(activeTab, queryClient)}` : '工作组标签页'}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {group.tabs.map((tab) => {
          const active = group.active === tab;
          const isPinned = group.pinned?.includes(tab) ?? false;
          const isPreview = group.preview === tab;
          const Icon = iconOf(tab);
          const title = titleOf(tab, queryClient);
          return (
            <ContextMenu key={tab}>
              <ContextMenuTrigger asChild>
                {/* 整个标签外壳即 role=tab：APG 要求 tablist 只拥有 tab；关闭钮对读屏隐藏
                    （aria-hidden + 不进 Tab 序），键盘关闭走右键菜单的「关闭」项。 */}
                <div
                  aria-controls={`tabpanel-${group.id}`}
                  aria-selected={active}
                  data-tab={tab}
                  data-active={active}
                  draggable
                  id={`tab-${group.id}-${tab}`}
                  ref={setTabRef(tab)}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    'group/tab relative flex h-8 min-w-32 max-w-56 shrink-0 select-none items-center gap-1.5 px-1.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    active
                      ? 'rounded-t-card bg-surface text-ink'
                      : 'rounded-control bg-hover text-ink-3 hover:bg-hover-strong hover:text-ink',
                    active &&
                      'before:absolute before:inset-x-1.5 before:top-0 before:h-0.5 before:rounded-full',
                    active && (unfocused ? 'before:bg-ink/25' : 'before:bg-ink'),
                  )}
                  onClick={() => openTab(tab, group.id)}
                  onDoubleClick={() => keepTab(tab, group.id)}
                  onKeyDown={(event) => onTabKeyDown(event, tab)}
                  onDragStart={(event) => {
                    setCurrentTabDrag({ tabId: tab, fromGroup: group.id });
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      tabDragType,
                      encodeTabDrag({ tabId: tab, fromGroup: group.id }),
                    );
                  }}
                  onDragEnd={() => setCurrentTabDrag(null)}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    // 固定标签防误触：中键不关闭（本地取向），关闭走右键菜单；但始终拦下中键自动滚动。
                    event.preventDefault();
                    if (!isPinned) closeTab(tab, group.id);
                  }}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate px-0.5 text-left text-xs',
                      isPreview && 'italic',
                      unfocused && 'opacity-55',
                    )}
                    title={isPreview ? `${title}（预览，双击保留）` : title}
                  >
                    {title}
                  </span>
                  {!isPinned && (
                    <IconButton
                      size="xs"
                      aria-hidden
                      className="relative after:absolute after:-inset-1 after:content-['']"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab, group.id);
                      }}
                    >
                      <X />
                    </IconButton>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {isPreview && (
                  <ContextMenuItem onSelect={() => keepTab(tab, group.id)}>保留</ContextMenuItem>
                )}
                <ContextMenuItem onSelect={() => togglePin(tab, group.id)}>
                  {isPinned ? '取消固定' : '固定'}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTab(tab, group.id)}>关闭</ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTabs(group.id, 'others', tab)}>
                  关闭其他
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={
                    !group.tabs
                      .slice(group.tabs.indexOf(tab) + 1)
                      .some((right) => !(group.pinned ?? []).includes(right))
                  }
                  onSelect={() => closeTabs(group.id, 'right', tab)}
                >
                  关闭右侧
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <GroupToolbar group={group} />
    </div>
  );
}
