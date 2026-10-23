// 项目文件树：条目动作、远端上传/下载都经 props 交给接线方；
// 远端子目录懒加载（./remote-tree），条目只读，不参与内部拖拽与移动。
import {
  Archive,
  Cloud,
  Download,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  FolderKanban,
  Loader2,
  Pencil,
  Trash2,
  FolderInput,
  FileInput,
  PanelRightOpen,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceArchiveId, type WorkspaceEntry } from '../../shared/api';
import { hiddenWorkspaceNames } from '../../shared/workspace';
import { Explorer, type ExplorerItem, type ExplorerPending } from '../components/ui/explorer';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../components/ui/dropdown-menu';
import type { EntryAction } from '../workspace/entry-actions';
import { remoteAccent } from './remote-color';
import { remoteTitle, useRemoteTree } from './remote-tree';
import { showToast } from '../app/toasts';
import { errorText, useWorkspaceStore } from '../workspace/store';

export type { EntryAction };

/** 连接过渡的延迟：热通道列一层只要几十毫秒，立刻画转圈等于每次打开都闪一下；
 *  冷启动（实测 3 秒级）才会越过它，那时空白必须被解释清楚。 */
export const CONNECT_HINT_DELAY_MS = 200;
const emptyExcludedIds: string[] = [];

/** 首次连接远端时的过渡：只转圈，细节（连的是哪台）留给项目行的悬浮提示。 */
function ConnectingHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), CONNECT_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <p className="flex items-center gap-2 px-3 py-3 text-xs text-ink-3" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      正在连接远端…
    </p>
  );
}

export function ProjectFileTree({
  entries: baseEntries,
  rootId,
  selected,
  expanded,
  onExpand,
  onSelect,
  onAction: onEntryAction,
  onMove,
  canDrop,
  onImportFiles,
  onOpenToSide,
  onRemoteAction,
  query,
  excludeIds = emptyExcludedIds,
  archived = false,
  pending,
  onActivate,
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
  /** 远端条目动作。端口预览是项目级动作，在文件树 header，不进条目菜单。 */
  onRemoteAction?: (action: 'download' | 'open' | 'upload', id: string) => void;
  query: string;
  excludeIds?: string[];
  archived?: boolean;
  /** 行内新建；parentId 用条目 id，树根（rootId）由这里换成 Explorer 的 null。 */
  pending?: ExplorerPending | null;
  onActivate?: (id: string) => void;
}) {
  // 名称输入框空名失焦即取消，必须等菜单的焦点回收结束再建行。
  const afterMenuClose = useAfterMenuClose();
  const [search, setSearch] = useState<{ key: string; entries: WorkspaceEntry[] } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const searchKey = `${rootId ?? ''}\0${query.trim()}`;
  useEffect(() => {
    if (!query.trim()) return;
    return window.dela?.workspace.onChanged?.(() => setSearchVersion((value) => value + 1));
  }, [query]);
  const entries = useMemo(() => {
    if (!query.trim() || search?.key !== searchKey) return baseEntries;
    return [
      ...new Map([...baseEntries, ...search.entries].map((item) => [item.id, item])).values(),
    ];
  }, [baseEntries, query, search, searchKey]);
  useEffect(() => {
    if (!query.trim() || !window.dela?.workspace.searchLocal) return;
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setLocalError(null);
      void window.dela!.workspace.searchLocal(rootId, query.trim()).then(
        (items) => {
          if (live) {
            setSearch({ key: searchKey, entries: items });
            setSearching(false);
          }
        },
        (error) => {
          if (live) {
            setLocalError(errorText(error));
            setSearching(false);
          }
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
      void window.dela?.workspace.searchLocal(rootId, '').catch(() => {});
    };
  }, [rootId, query, searchKey, searchVersion]);
  const directoryIds = useMemo(() => {
    const ids = new Set(expanded);
    if (rootId) ids.add(rootId);
    const parents = new Map(entries.map((item) => [item.id, item.parentId]));
    const belongs = (id: string) => {
      const seen = new Set<string>();
      let current: string | null | undefined = id;
      while (current !== undefined && !seen.has(current ?? '')) {
        if (current === rootId) return true;
        if (current === null) return false;
        seen.add(current);
        current = parents.get(current);
        if (current && current !== rootId && !ids.has(current)) return false;
      }
      return false;
    };
    const result = entries
      .filter(
        (item) =>
          ids.has(item.id) &&
          belongs(item.id) &&
          !item.remoteId &&
          (item.kind === 'folder' || item.kind === 'project'),
      )
      .map((item) => item.id);
    if (rootId === workspaceArchiveId) result.push(rootId);
    return result;
  }, [entries, expanded, rootId]);
  const directoriesKey = directoryIds.sort().join('\0');
  const ownedDirectories = useRef(new Set<string>());
  useEffect(() => {
    const next = new Set(directoryIds);
    const store = useWorkspaceStore.getState();
    for (const id of ownedDirectories.current) if (!next.has(id)) store.releaseDirectory(id);
    ownedDirectories.current = next;
    for (const id of next)
      void store.ensureDirectory(id).catch((error) => setLocalError(errorText(error)));
  }, [directoriesKey]);
  useEffect(
    () => () => {
      for (const id of ownedDirectories.current) useWorkspaceStore.getState().releaseDirectory(id);
    },
    [],
  );
  const { included, visible } = useMemo(() => {
    const excluded = new Set(excludeIds);
    const children = new Map<string | null, WorkspaceEntry[]>();
    for (const entry of entries) {
      const group = children.get(entry.parentId) ?? [];
      group.push(entry);
      children.set(entry.parentId, group);
    }
    const included = new Set<string>();
    const pending = [rootId];
    while (pending.length) {
      for (const entry of children.get(pending.pop()!) ?? []) {
        if (
          excluded.has(entry.id) ||
          included.has(entry.id) ||
          hiddenWorkspaceNames.has(entry.name)
        )
          continue;
        included.add(entry.id);
        pending.push(entry.id);
      }
    }
    return { included, visible: entries.filter((entry) => included.has(entry.id)) };
  }, [entries, rootId, excludeIds]);
  /** 条目级文件动作：失败统一走浮窗，不打断文件树。 */
  const runFileCommand = (title: string, command: () => Promise<void> | undefined) => {
    void Promise.resolve(command()).catch((cause: unknown) =>
      showToast({ variant: 'error', title, description: errorText(cause) }),
    );
  };
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
      gitIgnored: e.gitIgnored,
      // 同一台服务器的行同色：取色只看连接 id，同连接的项目行与子条目自然一致。
      accent,
    };
  });
  const all = [...nodes, ...remote.items];
  let filtered = all;
  let open = expanded;
  if (query.trim()) {
    const parents = new Map(all.map((node) => [node.id, node.parentId]));
    const keep = new Set(
      all
        .filter((n) => n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map((n) => n.id),
    );
    for (const id of keep) {
      let parent = parents.get(id);
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = parents.get(parent);
      }
    }
    filtered = all.filter((n) => keep.has(n.id));
    open = [...keep];
  }
  const remoteIds = new Set(remote.items.map((item) => item.id));
  const remoteDirs = new Set(remote.items.filter((item) => item.container).map((item) => item.id));
  const rememberResult = (id: string) => {
    const result = entries.find((item) => item.id === id);
    if (!result || baseEntries.some((item) => item.id === id)) return;
    const byId = new Map((search?.entries ?? []).map((item) => [item.id, item]));
    const chain: WorkspaceEntry[] = [];
    let current: WorkspaceEntry | undefined = result;
    while (current && !chain.some((item) => item.id === current!.id)) {
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    useWorkspaceStore.getState().rememberEntries(chain.reverse());
  };
  const onAction = (action: EntryAction, id: string | null) => {
    if (id) rememberResult(id);
    onEntryAction(action, id);
  };
  /** 远端目录点击展开，文件走只读预览（读取在接线方）。 */
  const selectNode = (id: string) => {
    if (remoteDirs.has(id)) {
      onExpand(id, !expanded.includes(id));
      return;
    }
    rememberResult(id);
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
    <DropdownMenuItem
      onSelect={() => {
        rememberResult(id);
        onOpenToSide?.(id);
      }}
    >
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
      {localError && (
        <p role="alert" className="px-3 py-2 text-xs text-red">
          {localError}
        </p>
      )}
      {query.trim() && searching && (
        <p role="status" className="px-3 py-2 text-xs text-ink-3">
          正在搜索…
        </p>
      )}
      {remote.degraded && (
        <p className="flex items-start gap-1.5 px-3 py-2 text-xs [overflow-wrap:anywhere] text-ink-3">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{remote.degraded}</span>
        </p>
      )}
      {remote.status && (
        <p className="px-3 py-2 text-xs [overflow-wrap:anywhere] text-ink-3" role="status">
          {remote.status}
        </p>
      )}
      {remote.connecting && <ConnectingHint />}
      <Explorer
        label="我的内容"
        items={filtered}
        selected={selected}
        expanded={open}
        onExpand={onExpand}
        onSelect={selectNode}
        onMove={
          onMove
            ? (drag, target) => {
                rememberResult(drag);
                if (target) rememberResult(target);
                onMove(drag, target);
              }
            : undefined
        }
        canDrop={canDrop}
        onImportFiles={onImportFiles}
        onOpenToSide={
          onOpenToSide
            ? (id) => {
                rememberResult(id);
                onOpenToSide(id);
              }
            : undefined
        }
        sortItems
        onActivate={
          onActivate
            ? (id) => {
                rememberResult(id);
                onActivate(id);
              }
            : undefined
        }
        pending={
          pending && { ...pending, parentId: pending.parentId === rootId ? null : pending.parentId }
        }
        actions={(item) =>
          // 远端子条目不是本地条目：给远端自己的菜单（下载/打开/上传），本地动作一个不留。
          remoteIds.has(item.id) ? (
            onRemoteAction ? (
              remoteMenu(item)
            ) : null
          ) : (
            <DropdownMenu>
              {menuTrigger(item.name)}
              <DropdownMenuContent align="start" onCloseAutoFocus={afterMenuClose.onCloseAutoFocus}>
                {/* 远端项目行没有本地目录，main 对它的新建一律拒绝，入口就不必给。 */}
                {item.container && !item.readOnly && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => afterMenuClose.defer(() => onAction('folder', item.id))}
                    >
                      <FolderPlus />
                      新建文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => afterMenuClose.defer(() => onAction('note', item.id))}
                    >
                      <FilePlus2 />
                      新建文件
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
                {!item.container && (
                  <>
                    <DropdownMenuItem
                      onSelect={() =>
                        runFileCommand('定位失败', () => window.dela?.workspace.openLocal(item.id))
                      }
                    >
                      <FolderOpen />
                      在文件夹中显示
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        runFileCommand('打开失败', () => window.dela?.workspace.openFile(item.id))
                      }
                    >
                      <ExternalLink />
                      用系统默认程序打开
                    </DropdownMenuItem>
                  </>
                )}
                {onOpenToSide && openToSideItem(item.id)}
                {/* 远端项目只能改 Dela 里登记的名字（远端目录不动）；移动/归档对它没有意义。 */}
                <DropdownMenuItem onSelect={() => onAction('rename', item.id)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                {!item.readOnly && (
                  <>
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
