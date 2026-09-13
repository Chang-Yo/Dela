import {
  Ellipsis,
  FilePlus2,
  FolderPlus,
  FolderKanban,
  Pencil,
  Trash2,
  FolderInput,
  FileInput,
} from 'lucide-react';
import type { WorkspaceEntry } from '../../../shared/api';
import { Explorer } from '../../components/ui/explorer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

export type EntryAction =
  'folder' | 'project' | 'note' | 'rename' | 'move' | 'remove' | 'promote' | 'import' | 'archive';

export function ProjectSidebar({
  entries,
  rootId,
  selected,
  expanded,
  onExpand,
  onSelect,
  onAction,
  onMove,
  canDrop,
  onImportFiles,
  query,
  excludeIds = [],
  archived = false,
}: {
  entries: WorkspaceEntry[];
  rootId: string | null;
  selected: string | null;
  expanded: string[];
  onExpand: (id: string, open: boolean) => void;
  onSelect: (id: string) => void;
  onAction: (action: EntryAction, id: string | null) => void;
  onMove?: (dragId: string, targetId: string | null) => void;
  canDrop?: (dragId: string, targetId: string) => boolean;
  onImportFiles?: (files: File[], targetId: string | null) => void;
  query: string;
  excludeIds?: string[];
  archived?: boolean;
}) {
  const excluded = new Set(excludeIds);
  const included = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const e of entries)
      if (e.parentId === parentId && !excluded.has(e.id) && !included.has(e.id)) {
        included.add(e.id);
        visit(e.id);
      }
  };
  visit(rootId);
  const nodes = entries
    .filter((e) => included.has(e.id))
    .map((e) => ({
      id: e.id,
      parentId: e.parentId === rootId ? null : e.parentId,
      name: e.name,
      project: e.kind === 'project',
      container: e.kind === 'folder' || e.kind === 'project',
    }));
  let filtered = nodes;
  let open = expanded;
  if (query.trim()) {
    const keep = new Set(
      nodes
        .filter((n) => n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map((n) => n.id),
    );
    for (const id of keep) {
      let parent = nodes.find((n) => n.id === id)?.parentId;
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = nodes.find((n) => n.id === parent)?.parentId;
      }
    }
    filtered = nodes.filter((n) => keep.has(n.id));
    open = [...keep];
  }
  return (
    <Explorer
      label="我的内容"
      items={filtered}
      selected={selected}
      expanded={open}
      onExpand={onExpand}
      onSelect={onSelect}
      onMove={onMove}
      canDrop={canDrop}
      onImportFiles={onImportFiles}
      actions={(item) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-6 place-items-center rounded hover:bg-background"
              aria-label={`${item.name} 的操作`}
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {item.container && (
              <>
                <DropdownMenuItem onSelect={() => onAction('folder', item.id)}>
                  <FolderPlus />
                  新建文件夹
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction('note', item.id)}>
                  <FilePlus2 />
                  新建笔记
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction('import', item.id)}>
                  <FileInput />
                  导入本地文件
                </DropdownMenuItem>
              </>
            )}
            {item.container && !item.project && (
              <DropdownMenuItem onSelect={() => onAction('promote', item.id)}>
                <FolderKanban />
                作为项目开展
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onAction('rename', item.id)}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction('move', item.id)}>
              <FolderInput />
              移动到…
            </DropdownMenuItem>
            {!archived && (
              <DropdownMenuItem onSelect={() => onAction('archive', item.id)}>
                <FolderInput />
                归档
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => onAction('remove', item.id)}>
              <Trash2 />
              移除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
