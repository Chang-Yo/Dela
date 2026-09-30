// 扁平标签栏：组内拖拽排序、跨组拖放、中键关闭、上下文菜单、激活滚动可见。
// 视觉沿用旧 EditorLayout 标签带（bg-muted chrome + 白色圆角活动标签），切换不做飞入飞出。
import { useEffect, useRef, type DragEvent } from 'react';
import { X } from 'lucide-react';
import type { GroupNode, TabId } from '../../shared/layout';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { cn } from '../lib/utils';
import { useWorkbenchLayout } from './layout-store';
import { iconOf, titleOf } from './registry';
import { encodeTabDrag, hasTabDrag, parseTabDrag, tabDragType } from './tab-dnd';
import { GroupToolbar } from './GroupToolbar';

export function TabBar({ group, unfocused }: { group: GroupNode; unfocused: boolean }) {
  const openTab = useWorkbenchLayout((s) => s.openTab);
  const closeTab = useWorkbenchLayout((s) => s.closeTab);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const splitGroup = useWorkbenchLayout((s) => s.splitGroup);
  const listRef = useRef<HTMLDivElement>(null);

  // 激活的标签滚动到可见区（VS Code 行为）：标签栏溢出时新激活的标签落在视口外毫无反馈。
  useEffect(() => {
    if (!group.active) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [group.active]);

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
    if (!payload) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    let index = group.tabs.length;
    if (target) {
      const tab = target.dataset.tab as TabId;
      index = Math.max(0, group.tabs.indexOf(tab));
      // 悬停标签后半段 → 插到其后；反馈克制，不移动既有标签位置。
      const rect = target.getBoundingClientRect();
      if (event.clientX > rect.left + rect.width / 2) index += 1;
    }
    moveTab(payload.tabId, payload.fromGroup, group.id, index);
  };

  const splitTo = (tab: TabId, orientation: 'vertical' | 'horizontal') => {
    openTab(tab, group.id);
    splitGroup(group.id, orientation);
  };

  return (
    <div className="flex h-10 min-w-0 shrink-0 bg-muted px-2 pt-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label="工作组标签页"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
        onWheel={(event) => {
          // 纵向滚轮在标签栏内转为横向滚动（VS Code 行为），触控板横向滚动原生支持。
          if (event.deltaY !== 0) event.currentTarget.scrollLeft += event.deltaY;
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {group.tabs.map((tab) => {
          const active = group.active === tab;
          const Icon = iconOf(tab);
          const title = titleOf(tab);
          return (
            <ContextMenu key={tab}>
              <ContextMenuTrigger asChild>
                <div
                  data-tab={tab}
                  data-active={active}
                  draggable
                  className={cn(
                    'group/tab flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-t-lg px-1.5',
                    active
                      ? 'bg-background shadow-xs'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      tabDragType,
                      encodeTabDrag({ tabId: tab, fromGroup: group.id }),
                    );
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      closeTab(tab, group.id);
                    }
                  }}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <button
                    role="tab"
                    aria-selected={active}
                    className={cn(
                      'min-w-0 flex-1 truncate px-0.5 text-left text-xs',
                      unfocused && 'opacity-55',
                    )}
                    title={title}
                    onClick={() => openTab(tab, group.id)}
                  >
                    {title}
                  </button>
                  <button
                    className="relative grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground after:absolute after:-inset-1 after:content-['']"
                    aria-label={`关闭 ${title}`}
                    onClick={() => closeTab(tab, group.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => splitTo(tab, 'vertical')}>
                  向右分屏
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => splitTo(tab, 'horizontal')}>
                  向下分屏
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTab(tab, group.id)}>关闭</ContextMenuItem>
                <ContextMenuItem onSelect={() => closeTabs(group.id, 'others', tab)}>
                  关闭其他
                </ContextMenuItem>
                {/* 右侧没有标签时无对象可关，禁用与 closeTabs 的空切片边界一致。 */}
                <ContextMenuItem
                  disabled={group.tabs.indexOf(tab) === group.tabs.length - 1}
                  onSelect={() => closeTabs(group.id, 'right', tab)}
                >
                  关闭右侧
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {!group.tabs.length && (
          <span className="self-center px-3 text-xs text-muted-foreground">未打开标签</span>
        )}
      </div>
      <GroupToolbar group={group} />
    </div>
  );
}
