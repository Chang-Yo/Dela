import { useRef, useState, type ReactNode, type KeyboardEvent, type DragEvent } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, FolderKanban } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ExplorerItem {
  id: string;
  parentId: string | null;
  name: string;
  container?: boolean;
  project?: boolean;
  badge?: string;
}

export const explorerDragType = 'application/x-dela-entry';

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
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null);
  const children = new Map<string | null, ExplorerItem[]>();
  for (const item of items) {
    const group = children.get(item.parentId) ?? [];
    group.push(item);
    children.set(item.parentId, group);
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
  const keyDown = (event: KeyboardEvent, index: number, item: ExplorerItem, branch: boolean) => {
    let target = index;
    if (event.key === 'ArrowDown') target = Math.min(visible.length - 1, index + 1);
    else if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = visible.length - 1;
    else if (event.key === 'ArrowRight') {
      if (branch && !open.has(item.id)) onExpand(item.id, true);
      else if (branch) target = Math.min(visible.length - 1, index + 1);
    } else if (event.key === 'ArrowLeft') {
      if (branch && open.has(item.id)) onExpand(item.id, false);
      else target = visible.findIndex((v) => v.item.id === item.parentId);
    } else if (event.key === 'Enter' || event.key === ' ') {
      onSelect(item.id);
      if (branch) onExpand(item.id, !open.has(item.id));
    } else return;
    event.preventDefault();
    root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[target]?.focus();
  };
  const droppable = (drag: string, target: string) =>
    drag !== target && (!canDrop || canDrop(drag, target));
  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const dragProps =
    onMove || onImportFiles
      ? (item: ExplorerItem, branch: boolean) => ({
          draggable: Boolean(onMove),
          onDragStart: (event: DragEvent) => {
            if (!onMove) return;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(explorerDragType, item.id);
            event.dataTransfer.setData('text/plain', item.name);
            setDragId(item.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setDropTarget(null);
          },
          onDragOver: (event: DragEvent) => {
            if (onImportFiles && branch && isFileDrag(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              if (externalDropTarget !== item.id) setExternalDropTarget(item.id);
              return;
            }
            if (!branch || !dragId || !droppable(dragId, item.id)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dropTarget !== item.id) setDropTarget(item.id);
          },
          onDragLeave: (event: DragEvent) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            if (dropTarget === item.id) setDropTarget(null);
            if (externalDropTarget === item.id) setExternalDropTarget(null);
          },
          onDrop: (event: DragEvent) => {
            if (onImportFiles && branch && isFileDrag(event)) {
              event.preventDefault();
              onImportFiles(Array.from(event.dataTransfer.files), item.id);
              setExternalDropTarget(null);
              return;
            }
            event.preventDefault();
            const drag = dragId ?? event.dataTransfer.getData(explorerDragType);
            if (drag && onMove && droppable(drag, item.id)) onMove(drag, item.id);
            setDragId(null);
            setDropTarget(null);
          },
        })
      : undefined;
  return (
    <div
      ref={root}
      role="tree"
      aria-label={label}
      className="grid content-start gap-0.5 p-2"
      onDragLeave={(event) => {
        if (
          onImportFiles &&
          isFileDrag(event) &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          setExternalDropTarget(null);
        }
      }}
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
      }}
    >
      {visible.map(({ item, level }, index) => {
        const branch = Boolean(item.container || children.has(item.id));
        const Icon = item.project
          ? FolderKanban
          : branch
            ? open.has(item.id)
              ? FolderOpen
              : Folder
            : FileText;
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
              onSelect(item.id);
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
              'group flex h-8 min-w-0 cursor-default items-center gap-1 rounded-lg pr-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              selected === item.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-foreground/75 hover:bg-accent/60',
              (dropTarget === item.id || externalDropTarget === item.id) &&
                'bg-accent/60 text-foreground',
            )}
            style={{ paddingLeft: `calc(var(--spacing) * ${2 + (level - 1) * 4})` }}
          >
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
            <Icon className="mr-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 truncate" title={item.name}>
              {item.name}
            </span>
            {item.badge && <span className="text-xs text-muted-foreground">{item.badge}</span>}
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
