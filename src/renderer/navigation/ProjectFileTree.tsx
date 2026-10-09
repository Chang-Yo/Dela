// 项目文件树：
// 筛选/折叠/拖放移动/文件导入入口经 props 注入，条目动作回调交给接线方。
// 远程项目的子目录在这里懒加载（见 ./remote-tree），远端条目只读：可展开可选中，
// 但不发起打开文档与拖放写入。
import { useState } from 'react';
import {
  Archive,
  Cloud,
  Ellipsis,
  FilePlus2,
  FolderPlus,
  FolderKanban,
  Pencil,
  Trash2,
  FolderInput,
  FileInput,
  PanelRightOpen,
} from 'lucide-react';
import type { WorkspaceEntry } from '../../shared/api';
import { Explorer, type ExplorerItem } from '../components/ui/explorer';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import type { EntryAction } from '../workspace/entry-actions';
import { remoteTitle, useRemoteTree } from './remote-tree';

export type { EntryAction };

export function ProjectFileTree({
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
  onOpenToSide,
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
  onOpenToSide?: (id: string) => void;
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
  const visible = entries.filter((e) => included.has(e.id));
  // 打开的项目工作台里项目行本身不在 visible（只有它的子条目在），远程根要单独带上。
  const remote = useRemoteTree(
    entries.filter((e) => included.has(e.id) || e.id === rootId),
    expanded,
    rootId,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const nodes: ExplorerItem[] = visible.map((e) => ({
    id: e.id,
    parentId: e.parentId === rootId ? null : e.parentId,
    name: e.name,
    project: e.kind === 'project',
    container: e.kind === 'folder' || e.kind === 'project',
    // 水源来源条目显示水滴图标，与其余资料区分。
    icon:
      e.kind === 'source' && e.sourceId?.startsWith('shuiyuan-topic:') ? ShuiyuanIcon : undefined,
    // 远端项目：云朵标记 + 「目的地:路径」提示，且不参与拖放写入。
    marker: e.remoteId ? Cloud : undefined,
    title: e.remoteId && e.path ? remoteTitle(remote.destinations[e.remoteId], e.path) : undefined,
    readOnly: Boolean(e.remoteId),
  }));
  const all = [...nodes, ...remote.items];
  let filtered = all;
  let open = expanded;
  if (query.trim()) {
    const keep = new Set(
      all
        .filter((n) => n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map((n) => n.id),
    );
    for (const id of keep) {
      let parent = all.find((n) => n.id === id)?.parentId;
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = all.find((n) => n.id === parent)?.parentId;
      }
    }
    filtered = all.filter((n) => keep.has(n.id));
    open = [...keep];
  }
  const remoteIds = new Set(remote.items.map((item) => item.id));
  const remoteDirs = new Set(remote.items.filter((item) => item.container).map((item) => item.id));
  /** 远端条目只做浏览：目录点击展开/收起，文件给出口提示，不发起 openDocument。 */
  const selectNode = (id: string) => {
    if (remoteDirs.has(id)) {
      setNotice(null);
      onExpand(id, !expanded.includes(id));
      return;
    }
    if (remoteIds.has(id)) {
      setNotice('远程文件的打开与预览在下一阶段');
      return;
    }
    setNotice(null);
    onSelect(id);
  };
  return (
    <>
      {remote.status && (
        <p className="px-3 py-2 text-[12px] [overflow-wrap:anywhere] text-ink-3" role="status">
          {remote.status}
        </p>
      )}
      {notice && (
        <p className="px-3 py-2 text-[12px] text-ink-3" role="status">
          {notice}
        </p>
      )}
      <Explorer
        label="我的内容"
        items={filtered}
        selected={selected}
        expanded={open}
        onExpand={onExpand}
        onSelect={selectNode}
        onMove={onMove}
        canDrop={canDrop}
        onImportFiles={onImportFiles}
        onOpenToSide={onOpenToSide}
        sortItems
        actions={(item) =>
          // 远端子条目不是本地条目，菜单里的动作都会失败：本轮不给菜单，只提供浏览。
          remoteIds.has(item.id) ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
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
                {onOpenToSide && (
                  <DropdownMenuItem onSelect={() => onOpenToSide(item.id)}>
                    <PanelRightOpen />
                    在侧边打开
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
                    <Archive />
                    归档
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onAction('remove', item.id)}
                >
                  <Trash2 />
                  移除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
    </>
  );
}
