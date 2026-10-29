import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type KeyboardEvent,
  type DragEvent,
  type CSSProperties,
} from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, FileText, Folder, FolderKanban } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fileIconUrl } from './file-icons';

export interface ExplorerItem {
  gitIgnored?: boolean;
  id: string;
  parentId: string | null;
  name: string;
  container?: boolean;
  project?: boolean;
  badge?: string;
  /** 自定义行图标（如水源来源的水滴、远端项目的云朵）：给了就顶掉容器/项目的默认图标。 */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** 行图标的强调色（CSS 颜色值）：同源的多行共用一色，视觉上归为一组。 */
  accent?: string;
  /** 行提示（默认条目名）；远端条目用它显示「目的地:路径」。 */
  title?: string;
  /** 只读条目：可展开可选中，但不参与内部拖拽与拖放落点（远端条目只做浏览）。 */
  readOnly?: boolean;
  /** 只读但仍接收外部文件拖放（远端目录：本地文件上传到远端，内部移动照旧被 readOnly 拦住）。 */
  importable?: boolean;
}

export const explorerDragType = 'application/x-dela-entry';

/** 行内新建：在 parentId 的子项最上方（null 为树根）插入一行名称输入框。 */
export interface ExplorerPending {
  parentId: string | null;
  kind: 'file' | 'folder';
  /** 回车或失焦时提交；返回错误文案则输入框保持打开并标红，返回 null 表示成功。 */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}

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
  pending,
  onActivate,
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
  pending?: ExplorerPending | null;
  /** 双击行：叶子条目「打开并保留」（预览转常驻）；目录行双击不触发。 */
  onActivate?: (id: string) => void;
}) {
  'use no memo';
  const root = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null);
  // 定位（面包屑 reveal 等）只展开祖先链不滚动树；选中行在视口外时滚到可见，否则点了像没反应。
  useEffect(() => {
    if (!selected) return;
    const index = visible.findIndex((row) => row.item.id === selected);
    if (virtualized && index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    root.current
      ?.querySelector('[role="treeitem"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected, expanded]);
  const children = useMemo(() => {
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
    return children;
  }, [items, sortItems]);
  const open = useMemo(() => new Set(expanded), [expanded]);
  const visible = useMemo(() => {
    const rows: { item: ExplorerItem; level: number }[] = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, level: number) => {
      for (const item of children.get(parentId) ?? []) {
        if (visited.has(item.id)) continue;
        visited.add(item.id);
        rows.push({ item, level });
        if (open.has(item.id)) walk(item.id, level + 1);
      }
    };
    walk(null, 1);
    return rows;
  }, [children, open]);
  const getItemKey = useCallback((index: number) => visible[index]!.item.id, [visible]);
  const pendingAt = pending
    ? pending.parentId === null
      ? { index: 0, level: 1 }
      : (() => {
          const index = visible.findIndex((v) => v.item.id === pending.parentId);
          return index < 0
            ? { index: 0, level: 1 }
            : { index: index + 1, level: visible[index]!.level + 1 };
        })()
    : null;
  const pendingAnchor = pendingAt ? Math.min(pendingAt.index, visible.length - 1) : -1;
  // 大树按滚动视口挂载；小树保留原生完整 DOM，避免为短列表引入滚动测量。
  const virtualized = visible.length > 100;
  const [scrollMargin, setScrollMargin] = useState(0);
  const [rowHeight, setRowHeight] = useState(28);
  const scrollElement = () => {
    let element = root.current?.parentElement ?? null;
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY))
      element = element.parentElement;
    return element;
  };
  // Explorer 显式退出自动 memo；虚拟行必须在每次滚动渲染时读取。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: scrollElement,
    estimateSize: () => rowHeight,
    getItemKey,
    scrollMargin,
    overscan: 8,
    enabled: virtualized,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      return pendingAnchor >= 0
        ? [...new Set([...indices, pendingAnchor])].sort((a, b) => a - b)
        : indices;
    },
  });
  useEffect(() => {
    if (virtualized && pendingAnchor >= 0)
      virtualizer.scrollToIndex(pendingAnchor, { align: 'auto' });
  }, [pendingAnchor, virtualized]);
  useLayoutEffect(() => {
    if (!virtualized || !root.current) return;
    const element = scrollElement();
    if (!element) return;
    const measure = () => {
      if (!root.current) return;
      const spacing = Number.parseFloat(
        getComputedStyle(root.current).getPropertyValue('--spacing'),
      );
      // Tailwind spacing 默认 0.25rem；行高由现有 h-7 token 决定。
      const rootStyle = getComputedStyle(root.current);
      const token = rootStyle.getPropertyValue('--spacing').trim();
      const unit = token.endsWith('rem')
        ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        : 1;
      if (Number.isFinite(spacing)) setRowHeight(spacing * unit * 7);
      setScrollMargin(
        root.current.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (root.current.parentElement) observer.observe(root.current.parentElement);
    return () => observer.disconnect();
  }, [virtualized, items]);
  const virtualRows = virtualizer.getVirtualItems();
  const rendered = virtualized
    ? virtualRows.map((row) => ({ ...visible[row.index]!, index: row.index, start: row.start }))
    : visible.map((row, index) => ({ ...row, index, start: 0 }));
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const element = root.current?.querySelector<HTMLElement>(
      `[data-tree-index="${pendingFocus.current}"]`,
    );
    if (element) {
      element.focus();
      pendingFocus.current = null;
    }
  });
  // 缩进对齐线：亮段跟随选中项的祖先链（含自身），同 VS Code 的 active guide。
  const parentOf = useMemo(() => new Map(items.map((item) => [item.id, item.parentId])), [items]);
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
    pendingFocus.current = index;
    if (virtualized) virtualizer.scrollToIndex(index, { align: 'auto' });
    const element = root.current?.querySelector<HTMLElement>(`[data-tree-index="${index}"]`);
    if (element) {
      element.focus();
      pendingFocus.current = null;
    }
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
    drag !== target &&
    !items.some((item) => item.id === target && item.readOnly) &&
    (!canDrop || canDrop(drag, target));
  // 拖拽悬停叶子行时，落点解析到所属目录（VS Code 式：整块目录区域都是落点）；
  // 内部拖拽中所属目录不可落（如拖动目录本身悬停在其子项上）则返回 null。
  // 文件拖放（drag === null）额外允许「只读但可接收文件」的落点：远端目录能上传，但不接受内部移动。
  const anchorBranch = (item: ExplorerItem, drag: string | null): string | null =>
    item.parentId !== null &&
    !items.some(
      (candidate) =>
        candidate.id === item.parentId &&
        candidate.readOnly &&
        !(drag === null && candidate.importable),
    ) &&
    (drag === null || droppable(drag, item.parentId))
      ? item.parentId
      : null;
  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  /** 文件拖放的落点：目录行本身（可接收文件的只读远端目录也算），否则落到所属目录。 */
  const fileDropTarget = (item: ExplorerItem, branch: boolean): string | null =>
    branch && (!item.readOnly || item.importable) ? item.id : anchorBranch(item, null);
  const dragProps =
    onMove || onImportFiles
      ? (item: ExplorerItem, branch: boolean) => ({
          draggable: Boolean(onMove) && !item.readOnly,
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
              const target = fileDropTarget(item, branch);
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
              const target = fileDropTarget(item, branch);
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
      className="grid min-w-0 w-full content-start gap-0 p-1"
      style={
        virtualized
          ? {
              position: 'relative',
              display: 'block',
              height: `calc(${virtualizer.getTotalSize()}px + 0.5rem)`,
            }
          : undefined
      }
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
      {pending && visible.length === 0 && pendingAt && (
        <PendingRow key="pending" pending={pending} level={pendingAt.level} />
      )}
      {rendered.map(({ item, level, index, start }) => {
        const branch = Boolean(item.container || children.has(item.id));
        // 目录行默认不画 folder 图标（折叠箭头已表达目录语义）；例外是携带信息的行：
        // 项目行的看板图标标记项目身份，强调色（远端同源分组）需要图标作颜色载体。
        // 文件行用逐扩展名的彩色图标（material-icon-theme 精选），未收录的回落文档图标。
        const fileIcon = !branch && !item.icon ? fileIconUrl(item.name) : null;
        const Icon = item.icon ?? (item.project ? FolderKanban : branch ? Folder : FileText);
        const showIcon = !branch || item.project || item.accent !== undefined;
        const accent = item.accent ? { color: item.accent } : undefined;
        const ancestors = trailOf(item.parentId);
        const dropRegion =
          activeDrop !== null && (activeDrop === item.id || ancestors.includes(activeDrop));
        return (
          <div
            key={item.id}
            data-index={index}
            className="min-w-0"
            ref={virtualized ? virtualizer.measureElement : undefined}
            style={
              virtualized
                ? {
                    position: 'absolute',
                    left: '0.25rem',
                    right: '0.25rem',
                    top: 0,
                    transform: `translateY(calc(${start - scrollMargin}px + 0.25rem))`,
                  }
                : undefined
            }
          >
            {pending && pendingAt?.index === index && (
              <PendingRow pending={pending} level={pendingAt.level} />
            )}
            <div
              role="treeitem"
              data-tree-index={index}
              aria-posinset={(children.get(item.parentId) ?? []).indexOf(item) + 1}
              aria-setsize={children.get(item.parentId)?.length}
              aria-label={item.name}
              aria-level={level}
              aria-expanded={branch ? open.has(item.id) : undefined}
              aria-selected={selected === item.id}
              tabIndex={
                selected === item.id ||
                (!visible.some((v) => v.item.id === selected) && index === 0)
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
              onDoubleClick={() => {
                if (!branch) onActivate?.(item.id);
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
                'group isolate relative flex h-7 min-w-0 cursor-default items-center gap-1 rounded-chip pr-1 text-13 outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-(--highlight-left) before:right-0 before:-z-10 before:rounded-sm before:transition-colors focus-visible:ring-2 focus-visible:ring-bui-accent',
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
              {showIcon &&
                (fileIcon ? (
                  <img alt="" className="mr-1 size-4 shrink-0" draggable={false} src={fileIcon} />
                ) : (
                  <Icon
                    className="mr-1 size-4 shrink-0 text-ink-3"
                    strokeWidth={1.8}
                    style={accent}
                  />
                ))}
              <span
                className={cn('min-w-0 flex-1 truncate', item.gitIgnored && 'text-ink-3')}
                title={item.title ?? item.name}
              >
                {item.name}
              </span>
              {item.badge && <span className="text-xs tabular-nums text-ink-3">{item.badge}</span>}
              {actions && (
                <span
                  className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 has-[[data-state=open]]:opacity-100 max-md:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  {actions(item)}
                </span>
              )}
            </div>
            {pending && pendingAt?.index === visible.length && index === visible.length - 1 && (
              <PendingRow pending={pending} level={pendingAt.level} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 新建条目的名称输入行：回车或失焦提交，Esc 取消；空名失焦等于取消。
 *  提交失败时边框标红、错误挂在下方，输入内容不丢，可直接改名重试。 */
function PendingRow({ pending, level }: { pending: ExplorerPending; level: number }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Esc 与回车之后都会触发 blur：已经处理过的这一轮不再重复提交或取消。
  const settled = useRef(false);
  const submit = async () => {
    if (busy.current || settled.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      settled.current = true;
      pending.onCancel();
      return;
    }
    busy.current = true;
    const failure = await pending.onSubmit(trimmed);
    busy.current = false;
    if (failure === null) settled.current = true;
    else setError(failure);
  };
  const Icon = pending.kind === 'folder' ? Folder : FileText;
  return (
    <div
      className="relative grid min-w-0 gap-0.5 py-0.5 pr-1"
      style={{ paddingLeft: `calc(var(--spacing) * ${6 + (level - 1) * 4})` }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Icon className="mr-1 size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
        <input
          autoFocus
          aria-label={pending.kind === 'folder' ? '新文件夹名称' : '新文件名称'}
          aria-invalid={error !== null}
          aria-describedby={error ? 'explorer-pending-error' : undefined}
          className={cn(
            'h-6 min-w-0 flex-1 rounded-sm border bg-surface px-1.5 text-13 text-ink outline-none',
            error ? 'border-red focus:border-red' : 'border-bui-accent',
          )}
          spellCheck={false}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              settled.current = true;
              pending.onCancel();
            }
          }}
          onBlur={() => void submit()}
        />
      </div>
      {error && (
        <p
          id="explorer-pending-error"
          role="alert"
          className="ml-5 text-xs [overflow-wrap:anywhere] text-red"
        >
          {error}
        </p>
      )}
    </div>
  );
}
