// 项目文件树：
// 筛选/折叠/拖放移动/文件导入入口经 props 注入，条目动作回调交给接线方。
// 远程项目的子目录在这里懒加载（见 ./remote-tree），远端条目只读：目录可展开并接收本地
// 文件拖放（上传），文件开只读预览，两者都不参与内部拖拽与移动。
import {
  Archive,
  Cloud,
  Download,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  FolderKanban,
  Pencil,
  Trash2,
  FolderInput,
  FileInput,
  PanelRightOpen,
  Upload,
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
import { remoteAccent } from './remote-color';
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
  onRemoteAction,
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
  /** 远端条目的动作：文件可下载/用系统程序打开，目录可上传本地文件。 */
  onRemoteAction?: (action: 'download' | 'open' | 'upload', id: string) => void;
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
  const nodes: ExplorerItem[] = visible.map((e) => {
    const accent = e.remoteId ? remoteAccent(e.remoteId, 'text') : undefined;
    const shuiyuan = e.kind === 'source' && Boolean(e.sourceId?.startsWith('shuiyuan-topic:'));
    return {
      id: e.id,
      parentId: e.parentId === rootId ? null : e.parentId,
      name: e.name,
      project: e.kind === 'project',
      container: e.kind === 'folder' || e.kind === 'project',
      // 水源来源条目显示水滴图标；远端项目行自己就是云朵，行内不再另挂标记。
      icon: shuiyuan ? ShuiyuanIcon : e.remoteId ? Cloud : undefined,
      // 远端项目行提示「目的地:路径」，且不参与拖放写入。
      title:
        e.remoteId && e.path ? remoteTitle(remote.destinations[e.remoteId], e.path) : undefined,
      readOnly: Boolean(e.remoteId),
      // 同一台服务器的行同色：取色只看连接 id，同连接的项目行与子条目自然一致。
      accent,
    };
  });
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
  /** 远端条目：目录点击展开/收起，文件走只读预览（读取在接线方）。 */
  const selectNode = (id: string) => {
    if (remoteDirs.has(id)) {
      onExpand(id, !expanded.includes(id));
      return;
    }
    onSelect(id);
  };
  // 失败出口与本地条目动作一致：接线方用 runEntryWork 收进 workspace store 的错误条。
  const runRemote = (action: 'download' | 'open' | 'upload', id: string) =>
    onRemoteAction?.(action, id);
  /** 两个菜单共用的触发器与「在侧边打开」：本地菜单的其余项远端一个都不能给。 */
  const menuTrigger = (name: string) => (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="grid size-6 place-items-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
        aria-label={`${name} 的操作`}
      >
        <Ellipsis className="size-4" />
      </button>
    </DropdownMenuTrigger>
  );
  const openToSideItem = (id: string) => (
    <DropdownMenuItem onSelect={() => onOpenToSide?.(id)}>
      <PanelRightOpen />
      在侧边打开
    </DropdownMenuItem>
  );
  const remoteMenu = (item: ExplorerItem) => (
    <DropdownMenu>
      {menuTrigger(item.name)}
      <DropdownMenuContent align="start">
        {item.container ? (
          <DropdownMenuItem onSelect={() => runRemote('upload', item.id)}>
            <Upload />
            上传本地文件
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => runRemote('download', item.id)}>
              <Download />
              下载到本地
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runRemote('open', item.id)}>
              <ExternalLink />
              用系统默认程序打开
            </DropdownMenuItem>
          </>
        )}
        {!item.container && onOpenToSide && openToSideItem(item.id)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      {remote.status && (
        <p className="px-3 py-2 text-[12px] [overflow-wrap:anywhere] text-ink-3" role="status">
          {remote.status}
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
          // 远端子条目不是本地条目：给远端自己的菜单（下载/打开/上传），本地动作一个不留。
          remoteIds.has(item.id) ? (
            onRemoteAction ? (
              remoteMenu(item)
            ) : null
          ) : (
            <DropdownMenu>
              {menuTrigger(item.name)}
              <DropdownMenuContent align="start">
                {/* 远端项目行没有本地目录，main 对它的新建一律拒绝，入口就不必给。 */}
                {item.container && !item.readOnly && (
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
                {onOpenToSide && openToSideItem(item.id)}
                {/* 远端项目的重命名/移动/归档都走 main 的 update，而那条路径对远端项目一律拒绝
                    （改的只是本地登记行，改了也没意义）：远端项目行只留「移除」这条本地操作。 */}
                {!item.readOnly && (
                  <>
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
                  </>
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
