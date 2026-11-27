// 条目动作与远端上传/下载都经 props 交给接线方；远端条目只读，不参与内部拖拽与移动。
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
  Pencil,
  Trash2,
  FolderInput,
  FileInput,
  PanelRightOpen,
  SquareArrowOutUpRight,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import {
  workspaceArchiveId,
  type WorkspaceEntry,
  hiddenWorkspaceNames,
} from '../../../modules/workspace/contract';
import {
  Explorer,
  type ExplorerItem,
  type ExplorerPending,
  useWorkspaceStore,
} from '../../../modules/workspace/view';
import { sources } from '../../views';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../../../ui/dropdown-menu';
import type { EntryAction } from '../workspace/entry-actions';
import { libraryEntriesOf } from '../workspace/library-entries';
import { remoteAccent } from '../../../modules/remotes/view';
import { remoteTitle, useRemoteTree } from './remote-tree';
import { showToast } from '../../../ui/toast';
import { onWorkspaceEvent, workspaceClient } from '../../../modules/workspace/view';
import { ErrorText } from '../../../ui/error-text';
import { Spinner } from '../../../ui/spinner';
import { Button } from '../../../ui/button';
import { errorMessage } from '../../../core/protocol/contract';

export type { EntryAction };

/** 热通道列一层只要几十毫秒，立刻画转圈会每次都闪；冷启动（约 3 秒）才越过它。 */
const CONNECT_HINT_DELAY_MS = 200;
const emptyExcludedIds: string[] = [];

function ConnectingHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), CONNECT_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <p className="flex items-center gap-2 px-3 py-3 text-xs text-ink-3" role="status">
      <Spinner size="sm" />
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
  onOpenProject,
  onRemoteAction,
  libraryRoot,
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
  onOpenProject?: (id: string) => void;
  onRemoteAction?: (action: 'download' | 'open' | 'upload', id: string) => void;
  libraryRoot?: string;
  query: string;
  excludeIds?: string[];
  archived?: boolean;
  pending?: ExplorerPending | null;
  onActivate?: (id: string) => void;
}) {
  // 名称输入框空名失焦即取消，必须等菜单的焦点回收结束再建行。
  const afterMenuClose = useAfterMenuClose();
  const queryClient = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const [term] = useDebounce(trimmedQuery, 250);
  const search = useQuery({
    queryKey: ['workspace', 'search-local', rootId, term],
    queryFn: ({ signal }) => {
      signal.addEventListener(
        'abort',
        () => void workspaceClient.searchLocal({ rootId, query: '' }).catch(() => {}),
      );
      return workspaceClient.searchLocal({ rootId, query: term });
    },
    enabled: Boolean(term) && Boolean(window.dela),
  });
  const searching = trimmedQuery !== '';
  useEffect(() => {
    if (!searching) return;
    return onWorkspaceEvent(
      'changed',
      () => void queryClient.invalidateQueries({ queryKey: ['workspace', 'search-local', rootId] }),
    );
  }, [searching, rootId, queryClient]);
  const searchEntries = search.data && term === trimmedQuery ? search.data : [];
  const merged = searchEntries.length
    ? [...new Map([...baseEntries, ...searchEntries].map((item) => [item.id, item])).values()]
    : baseEntries;
  const entries = libraryRoot ? libraryEntriesOf(merged, libraryRoot) : merged;
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
  const directoryIds = entries
    .filter(
      (item) =>
        ids.has(item.id) &&
        belongs(item.id) &&
        !item.remoteId &&
        (item.kind === 'folder' || item.kind === 'project'),
    )
    .map((item) => item.id);
  if (rootId === workspaceArchiveId) directoryIds.push(rootId);
  const directoriesKey = directoryIds.sort().join('\0');
  const owner = useId();
  useEffect(() => {
    void useWorkspaceStore
      .getState()
      .holdDirectories(owner, directoryIds)
      .catch((error) => setLocalError(errorMessage(error)));
  }, [directoriesKey]);
  useEffect(() => () => void useWorkspaceStore.getState().holdDirectories(owner, []), []);
  const excluded = new Set(excludeIds);
  const children = new Map<string | null, WorkspaceEntry[]>();
  for (const entry of entries) {
    const group = children.get(entry.parentId) ?? [];
    group.push(entry);
    children.set(entry.parentId, group);
  }
  const included = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    for (const entry of children.get(queue.pop()!) ?? []) {
      if (excluded.has(entry.id) || included.has(entry.id) || hiddenWorkspaceNames.has(entry.name))
        continue;
      included.add(entry.id);
      queue.push(entry.id);
    }
  }
  const visible = entries.filter((entry) => included.has(entry.id));
  const runFileCommand = (title: string, command: () => Promise<void> | undefined) => {
    void Promise.resolve(command()).catch((cause: unknown) =>
      showToast({ variant: 'error', title, description: errorMessage(cause) }),
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
    const source = e.kind === 'source' && e.sourceId ? sources.of(e.sourceId) : undefined;
    const Badge = source?.badge;
    return {
      id: e.id,
      parentId: e.parentId === rootId ? null : e.parentId,
      name: e.name,
      project: e.kind === 'project',
      container: e.kind === 'folder' || e.kind === 'project',
      icon: source?.icon ?? (e.remoteId ? Cloud : undefined),
      badge: Badge && <Badge sourceId={e.sourceId!} />,
      title:
        e.remoteId && e.path ? remoteTitle(remote.destinations[e.remoteId], e.path) : undefined,
      readOnly: Boolean(e.remoteId),
      gitIgnored: e.gitIgnored,
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
    const byId = new Map(searchEntries.map((item) => [item.id, item]));
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
  const selectNode = (id: string) => {
    if (remoteDirs.has(id)) {
      onExpand(id, !expanded.includes(id));
      return;
    }
    rememberResult(id);
    onSelect(id);
  };
  const runRemote = (action: 'download' | 'open' | 'upload', id: string) =>
    onRemoteAction?.(action, id);
  const menuTrigger = (name: string) => (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="icon-xs"

        aria-label={`${name} 的操作`}
      >
        <Ellipsis />
      </Button>
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
      {(localError ?? (search.error ? errorMessage(search.error) : null)) && (
        <ErrorText className="px-3 py-2">{localError ?? errorMessage(search.error)}</ErrorText>
      )}
      {searching && search.isFetching && (
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
          remoteIds.has(item.id) ? (
            onRemoteAction ? (
              remoteMenu(item)
            ) : null
          ) : (
            <DropdownMenu>
              {menuTrigger(item.name)}
              <DropdownMenuContent align="start" onCloseAutoFocus={afterMenuClose.onCloseAutoFocus}>
                {item.project && onOpenProject && (
                  <DropdownMenuItem onSelect={() => onOpenProject(item.id)}>
                    <SquareArrowOutUpRight />
                    打开项目
                  </DropdownMenuItem>
                )}
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
                        runFileCommand('定位失败', () => workspaceClient.openLocal(item.id))
                      }
                    >
                      <FolderOpen />
                      在文件夹中显示
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        runFileCommand('打开失败', () => workspaceClient.openFile(item.id))
                      }
                    >
                      <ExternalLink />
                      用系统默认程序打开
                    </DropdownMenuItem>
                  </>
                )}
                {onOpenToSide && openToSideItem(item.id)}
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
