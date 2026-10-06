// 扁平标签栏：组内拖拽排序、跨组拖放、中键关闭、上下文菜单、激活滚动可见。
// 视觉：标签栏与内容区同底色，活动标签融入背景，非活动标签为淡灰块；切换不做飞入飞出。
import { memo, useEffect, useRef, type DragEvent, type KeyboardEvent } from 'react';
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
import { ExplorerRevealButton } from './explorer-state';
import { encodeTabDrag, hasTabDrag, parseTabDrag, setCurrentTabDrag, tabDragType } from './tab-dnd';
import { GroupToolbar } from './GroupToolbar';

export const TabBar = memo(function TabBar({
  group,
  unfocused,
}: {
  group: GroupNode;
  unfocused: boolean;
}) {
  const openTab = useWorkbenchLayout((s) => s.openTab);
  const closeTab = useWorkbenchLayout((s) => s.closeTab);
  const closeTabs = useWorkbenchLayout((s) => s.closeTabs);
  const moveTab = useWorkbenchLayout((s) => s.moveTab);
  const splitGroup = useWorkbenchLayout((s) => s.splitGroup);
  const listRef = useRef<HTMLDivElement>(null);
  // roving tabindex 的焦点登记：方向键把焦点移到目标标签（选中态跟随，自动激活模式）。
  const tabRefs = useRef(new Map<TabId, HTMLDivElement>());

  // 激活的标签滚动到可见区（VS Code 行为）：标签栏溢出时新激活的标签落在视口外毫无反馈。
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

  // APG tabs 键盘模式：←/→/Home/End 移动并激活，Enter/Space 激活当前。
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

  const activeTab = group.active;
  if (!group.tabs.length) return null;

  return (
    <div className="@container flex h-10 min-w-0 shrink-0 bg-background px-2 pt-1">
      {/* 目录折叠时的展开入口：只在焦点组的标签栏左端（视线跟随焦点，其他组不重复出现）。 */}
      {!unfocused && <ExplorerRevealButton className="mb-1 self-end" />}
      {/* 空组时 tablist 无 tab 可拥有，role 一并撤下（占位文本不属于 tablist）。 */}
      <div
        ref={listRef}
        role={group.tabs.length ? 'tablist' : undefined}
        aria-label={
          group.tabs.length
            ? activeTab
              ? `标签页：${titleOf(activeTab)}`
              : '工作组标签页'
            : undefined
        }
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
                    'group/tab relative flex h-8 min-w-32 max-w-56 shrink-0 select-none items-center gap-1.5 px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    active
                      ? 'rounded-t-lg bg-background'
                      : 'rounded-md bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                    active &&
                      'before:absolute before:inset-x-1.5 before:top-0 before:h-0.5 before:rounded-full',
                    active && (unfocused ? 'before:bg-primary/25' : 'before:bg-primary'),
                  )}
                  onClick={() => openTab(tab, group.id)}
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
                    if (event.button === 1) {
                      event.preventDefault();
                      closeTab(tab, group.id);
                    }
                  }}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate px-0.5 text-left text-xs',
                      unfocused && 'opacity-55',
                    )}
                    title={title}
                  >
                    {title}
                  </span>
                  <button
                    aria-hidden
                    className="relative grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground after:absolute after:-inset-1 after:content-['']"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab, group.id);
                    }}
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
      </div>
      <GroupToolbar group={group} />
    </div>
  );
});
