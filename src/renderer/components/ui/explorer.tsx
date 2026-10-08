import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type KeyboardEvent,
  type DragEvent,
  type CSSProperties,
} from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, FolderKanban } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ExplorerItem {
  id: string;
  parentId: string | null;
  name: string;
  container?: boolean;
  project?: boolean;
  badge?: string;
  /** 叶子条目的自定义图标（如水源来源的水滴）；默认 FileText。 */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export const explorerDragType = 'application/x-dela-entry';

const explorerCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function Explorer({
  items,
  expanded,
  selected,
  onExpand,
  onSelect,
  label,
  actions,
  onMove,
  canDrop,
  onImportFiles,
  onOpenToSide,
  sortItems = false,
}: {
  items: ExplorerItem[];
  expanded: string[];
  selected: string | null;
  onExpand: (id: string, open: boolean) => void;
  onSelect: (id: string) => void;
  label: string;
  actions?: (item: ExplorerItem) => ReactNode;
  onMove?: (dragId: string, targetId: string | null) => void;
  canDrop?: (dragId: string, targetId: string) => boolean;
  onImportFiles?: (files: File[], targetId: string | null) => void;
  /** 修饰键单击时在另一编辑器组打开条目。 */
  onOpenToSide?: (id: string) => void;
  /** 仅对不依赖业务顺序的树启用文件夹优先自然排序。 */
  sortItems?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null);
  // 定位（面包屑 reveal 等）只展开祖先链不滚动树；选中行在视口外时滚到可见，否则点了像没反应。
  useEffect(() => {
    if (!selected) return;
    root.current
      ?.querySelector('[role="treeitem"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  const children = new Map<string | null, ExplorerItem[]>();
  for (const item of items) {
    const group = children.get(item.parentId) ?? [];
    group.push(item);
    children.set(item.parentId, group);
  }
  if (sortItems) {
    for (const group of children.values())
      group.sort((a, b) => {
        const aBranch = Boolean(a.container || children.has(a.id));
        const bBranch = Boolean(b.container || children.has(b.id));
        return Number(bBranch) - Number(aBranch) || explorerCollator.compare(a.name, b.name);
      });
  }
  const open = new Set(expanded);
  const visible: { item: ExplorerItem; level: number }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, level: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      visible.push({ item, level });
      if (open.has(item.id)) walk(item.id, level + 1);
    }
  };
  walk(null, 1);
  // 缩进对齐线：亮段跟随选中项的祖先链（含自身），同 VS Code 的 active guide。
  const parentOf = new Map(items.map((item) => [item.id, item.parentId]));
  const trailOf = (id: string | null): string[] => {
    const chain: string[] = [];
    for (let current = id; current; current = parentOf.get(current) ?? null) chain.unshift(current);
    return chain;
  };
  const selectedTrail = new Set<string>();
  for (
    let current: string | null | undefined = selected;
    current;
    current = parentOf.get(current) ?? null
  ) {
    if (selectedTrail.has(current)) break;
    selectedTrail.add(current);
  }
  const typeahead = useRef({ query: '', at: 0 });
  const resetDrag = () => {
    setDragId(null);
    setDropTarget(null);
    setExternalDropTarget(null);
  };
  const focusItem = (index: number) => {
    root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus();
  };
  const keyDown = (event: KeyboardEvent, index: number, item: ExplorerItem, branch: boolean) => {
    let target = index;
    if (event.key === 'ArrowDown') target = Math.min(visible.length - 1, index + 1);
    else if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = visible.length - 1;
    else if (event.key === 'ArrowRight') {
      if (branch && !open.has(item.id)) onExpand(item.id, true);
      else if (branch && visible[index + 1]?.item.parentId === item.id) target = index + 1;
    } else if (event.key === 'ArrowLeft') {
      if (branch && open.has(item.id)) onExpand(item.id, false);
      else {
        const parent = visible.findIndex((v) => v.item.id === item.parentId);
        if (parent >= 0) target = parent;
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      onSelect(item.id);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      // KeyboardEvent.timeStamp is monotonic for the current event stream and
      // keeps the handler pure from the renderer's point of view.
      const now = event.timeStamp;
      const query =
        now - typeahead.current.at < 700 ? typeahead.current.query + event.key : event.key;
      typeahead.current = { query, at: now };
      const lower = query.toLocaleLowerCase();
      const next = [...visible.slice(index + 1), ...visible.slice(0, index + 1)].findIndex(
        ({ item: candidate }) => candidate.name.toLocaleLowerCase().startsWith(lower),
      );
      if (next < 0) return;
      target = (index + 1 + next) % visible.length;
    } else return;
    event.preventDefault();
    focusItem(target);
  };
  const droppable = (drag: string, target: string) =>
    drag !== target && (!canDrop || canDrop(drag, target));
  // 拖拽悬停叶子行时，落点解析到所属目录（VS Code 式：整块目录区域都是落点）；
  // 内部拖拽中所属目录不可落（如拖动目录本身悬停在其子项上）则返回 null。
  const anchorBranch = (item: ExplorerItem, drag: string | null): string | null =>
    item.parentId !== null && (drag === null || droppable(drag, item.parentId))
      ? item.parentId
      : null;
  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const dragProps =
    onMove || onImportFiles
      ? (item: ExplorerItem, branch: boolean) => ({
          draggable: Boolean(onMove),
          onDragStart: (event: DragEvent) => {
            if (!onMove) return;
            setDropTarget(null);
            setExternalDropTarget(null);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(explorerDragType, item.id);
            event.dataTransfer.setData('text/plain', item.name);
            setDragId(item.id);
          },
          onDragEnd: () => {
            resetDrag();
          },
          onDragOver: (event: DragEvent) => {
            if (onImportFiles && isFileDrag(event)) {
              const target = branch ? item.id : anchorBranch(item, null);
              if (target === null) {
                if (externalDropTarget !== null) setExternalDropTarget(null);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              if (externalDropTarget !== target) setExternalDropTarget(target);
              return;
            }
            if (!dragId) return;
            const target = branch
              ? droppable(dragId, item.id)
                ? item.id
                : null
              : anchorBranch(item, dragId);
            if (target === null) {
              if (dropTarget !== null) setDropTarget(null);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dropTarget !== target) setDropTarget(target);
          },
          onDrop: (event: DragEvent) => {
            if (onImportFiles && isFileDrag(event)) {
              const target = branch ? item.id : anchorBranch(item, null);
              // 顶层叶子行不接收，交给树根落点。
              if (target === null) return;
              event.preventDefault();
              onImportFiles(Array.from(event.dataTransfer.files), target);
              resetDrag();
              return;
            }
            event.preventDefault();
            const drag = dragId ?? event.dataTransfer.getData(explorerDragType);
            const target = branch ? item.id : anchorBranch(item, drag);
            if (drag && onMove && target !== null && droppable(drag, target)) onMove(drag, target);
            resetDrag();
          },
        })
      : undefined;
  // 落点区域：目标目录行与其全部可见后代行连成一块高亮（VS Code 式），
  // 叶子行悬停时经由 anchorBranch 落到所属目录，区域因此覆盖整个子树。
  const activeDrop = dropTarget ?? externalDropTarget;
  return (
    <div
      ref={root}
      role="tree"
      aria-label={label}
      className="grid content-start gap-0 p-1"
      onDragLeave={(event) => {
        // 指针离开整棵树才清除落点；行间移动由各行的 onDragOver 接力更新。
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        resetDrag();
      }}
      onDragEnd={resetDrag}
      onDragOver={(event) => {
        if (onImportFiles && isFileDrag(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        if (!onImportFiles || !isFileDrag(event)) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        onImportFiles(Array.from(event.dataTransfer.files), null);
        resetDrag();
      }}
    >
      {visible.map(({ item, level }, index) => {
        const branch = Boolean(item.container || children.has(item.id));
        // 目录 icon 只保留到第二层（学期/课程这类主目录），更深的子目录只留
        // 折叠箭头与文字；叶子文件 icon 不受影响。
        const Icon = item.project
          ? FolderKanban
          : branch
            ? open.has(item.id)
              ? FolderOpen
              : Folder
            : (item.icon ?? FileText);
        const showIcon = !branch || level <= 2;
        const ancestors = trailOf(item.parentId);
        const dropRegion =
          activeDrop !== null && (activeDrop === item.id || ancestors.includes(activeDrop));
        return (
          <div
            key={item.id}
            role="treeitem"
            aria-label={item.name}
            aria-level={level}
            aria-expanded={branch ? open.has(item.id) : undefined}
            aria-selected={selected === item.id}
            tabIndex={
              selected === item.id || (!visible.some((v) => v.item.id === selected) && index === 0)
                ? 0
                : -1
            }
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) keyDown(event, index, item, branch);
            }}
            {...dragProps?.(item, branch)}
            onClick={(event) => {
              event.currentTarget.focus();
              if (event.altKey && onOpenToSide) onOpenToSide(item.id);
              else onSelect(item.id);
            }}
            onContextMenu={(event) => {
              const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
                '[data-slot="dropdown-menu-trigger"]',
              );
              if (trigger) {
                event.preventDefault();
                trigger.click();
              }
            }}
            className={cn(
              'group isolate relative flex h-7 min-w-0 cursor-default items-center gap-1 rounded-chip pr-1 text-[13px] outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-(--highlight-left) before:right-0 before:-z-10 before:rounded-sm before:transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              selected === item.id
                ? 'before:bg-hover-2 font-medium text-ink'
                : // 目录列底色为 inset，hover 用 hover-2 才与其拉开层次。
                  'text-ink-2 hover:text-ink hover:before:bg-hover-2',
              // 落点区域行去圆角，使目录子树区域连成一块整色；蓝色调与选中态的
              // 中性灰区分（--drop-target，globals.css 三作用域定义）。
              dropRegion && 'rounded-none bg-drop-target text-ink',
            )}
            style={
              {
                paddingLeft: `calc(var(--spacing) * ${2 + (level - 1) * 4})`,
                // 叶子行保留图标前一格内边距；目录行包含折叠箭头。
                '--highlight-left': `calc(var(--spacing) * ${(branch ? 2 : 6) + (level - 1) * 4})`,
              } as CSSProperties
            }
          >
            {Array.from({ length: level - 1 }, (_, guide) => (
              <span
                key={guide}
                aria-hidden
                className={cn(
                  'absolute inset-y-0 w-px -translate-x-1/2',
                  selectedTrail.has(ancestors[guide] ?? '') ? 'bg-line-strong' : 'bg-line',
                )}
                style={{ left: `calc(var(--spacing) * ${4 + guide * 4})` }}
              />
            ))}
            <button
              type="button"
              aria-label={`${open.has(item.id) ? '收起' : '展开'} ${item.name}`}
              tabIndex={-1}
              className={cn('grid size-4 shrink-0 place-items-center', !branch && 'invisible')}
              onClick={(event) => {
                event.stopPropagation();
                onExpand(item.id, !open.has(item.id));
              }}
            >
              <ChevronRight
                className={cn(
                  'size-3 transition-transform duration-150 motion-reduce:transition-none',
                  open.has(item.id) && 'rotate-90',
                )}
              />
            </button>
            {showIcon && <Icon className="mr-1 size-4 shrink-0 text-ink-3" strokeWidth={1.8} />}
            <span className="min-w-0 flex-1 truncate" title={item.name}>
              {item.name}
            </span>
            {item.badge && (
              <span className="text-[11.5px] tabular-nums text-ink-3">{item.badge}</span>
            )}
            {actions && (
              <span
                className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                {actions(item)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
