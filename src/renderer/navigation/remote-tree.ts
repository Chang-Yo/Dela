// 远程项目在文件树里的懒加载：展开一层拉一层，每层是一条查询，收起即丢弃——远端是这些条目的唯一事实来源。
// 子条目 id 带项目身份（remoteNodeId）：只用路径会让两台连接上的同路径目录串成同一个节点。
import { useEffect, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceEntry } from '../../shared/api';
import type { RemoteDirectoryEntry } from '../../modules/remotes/contract';
import { remoteNodeId } from '../../modules/remotes/contract';
import { hiddenWorkspaceNames } from '../../modules/workspace/contract';
import { onWorkspaceEvent, workspaceClient } from '../../modules/workspace/view';
import { remoteAccent, useRemoteChannels } from '../../modules/remotes/view';
import type { ExplorerItem } from '../components/explorer';
import { errorText } from '../workspace/store';
import { useRemoteActivity } from './remote-activity';
import { useRemoteConnections } from './remote-connections';

/** 项目根的 path 可能带尾斜杠，远端子路径一律不带：统一后再作缓存与展开键。 */
const trimSlash = (path: string) => path.replace(/\/+$/, '');

/** 远端变化通知的合并窗口：一次工具调用常连写几个文件，攒一下再重读，别一文件一请求。 */
const CHANGE_DEBOUNCE_MS = 300;

/** 上报 watch 的合并窗口：展开/收起常成串发生，攒一下只报最终集合。 */
const WATCH_DEBOUNCE_MS = 150;

const directoryQueries = ['workspace', 'listRemoteDirectory'];

/** 是否落在变化目录之内（含它自己）：这些清单都要重读。 */
const withinChange = (path: string, changed: string) =>
  path === changed || path.startsWith(`${changed}/`);

/** 展开的远端目录报给主进程做 watch：Dela 之外改的远端文件因此也能自己出现在树里。 */
function createRemoteWatcher() {
  /** 已经报给主进程的监视集合（项目 id → 序列化后的路径列表）：没变就不重报。 */
  const reported = new Map<string, string>();
  let wanted = new Map<string, string[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    for (const projectId of reported.keys()) if (!wanted.has(projectId)) wanted.set(projectId, []);
    for (const [projectId, paths] of wanted) {
      const serialized = paths.join('\n');
      if (reported.get(projectId) === serialized) continue;
      reported.set(projectId, serialized);
      void workspaceClient.watchRemoteDirectories({ projectId, paths }).catch((error: unknown) => {
        // 报不上去只是少了实时刷新：工具改动那条路照常，不打扰用户，但留一条线索。
        console.warn('[workspace] 上报远端监视目录失败', error);
        reported.delete(projectId);
      });
    }
  };
  return {
    /** 窗口内只记最新集合，窗口结束才发；不再展开的项目由 flush 补一次空集合取消监视。 */
    report(next: Map<string, string[]>) {
      wanted = next;
      timer ??= setTimeout(flush, WATCH_DEBOUNCE_MS);
    },
    /** 树卸载时取消监视：远端不该继续为看不见的目录留 inotify watch，待发的窗口也一并清掉。 */
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      wanted = new Map();
      for (const projectId of reported.keys())
        void workspaceClient.watchRemoteDirectories({ projectId, paths: [] }).catch(() => {});
      reported.clear();
    },
  };
}

export const remoteTitle = (destination: string | undefined, path: string) =>
  destination ? `${destination}:${trimSlash(path)}` : trimSlash(path);

export interface RemoteTree {
  /** 远端项目已缓存子目录对应的树节点（本地条目之外的部分）。 */
  items: ExplorerItem[];
  /** 远端连接 id → ssh 目的地；行提示用。 */
  destinations: Record<string, string>;
  /** 正在读取或读取失败的说明；无则 null。 */
  status: string | null;
  /** helper 通道不可用或重连中的提示（对准这棵树里可见的项目）；无则 null。 */
  degraded: string | null;
  /** 打开的项目正在首次连接（冷启动几秒）且还没有任何内容：面板该给过渡而不是空着。 */
  connecting: boolean;
}

/**
 * 传入的必须是这棵树里可见的条目（外加 rootId 自身）：展开态被多棵树共用，不可见的远程
 * 项目不该触发远端请求。rootId 是打开的项目 id，此时项目行不显示，内容直接落在顶层。
 */
export function useRemoteTree(
  entries: WorkspaceEntry[],
  expanded: string[],
  rootId: string | null,
): RemoteTree {
  const queryClient = useQueryClient();
  const setPhase = useRemoteActivity((state) => state.setPhase);
  const rootActivity = useRemoteActivity((state) => (rootId ? state.byProject[rootId] : undefined));
  const connections = useRemoteConnections();
  const destinations = Object.fromEntries(
    Object.entries(connections).map(([id, connection]) => [id, connection.host]),
  );
  const [watcher] = useState(createRemoteWatcher);
  /** 项目自身的展开键与打开的项目 id 等价：项目打开时它必然展开，行本身不在树里。 */
  const isOpen = (key: string) => key === rootId || expanded.includes(key);

  const projects = entries.filter(
    (entry) => entry.kind === 'project' && entry.remoteId && entry.path,
  );
  const channels = Object.values(useRemoteChannels(projects.length > 0));
  /** 远端目录在树里的键：项目根用条目 id（与树里项目行一致），子目录带上项目身份。
   *  归属只由「从哪个项目走下来」决定，远端路径本身不再参与跨项目的解释。 */
  const keyOf = (project: WorkspaceEntry, path: string) =>
    trimSlash(project.path!) === path ? project.id : remoteNodeId(project.id, path);

  // 展开且可达的远端目录各是一条查询：子目录要等父目录的清单回来才知道，所以沿缓存往下走。
  const openDirectories: { key: string; projectId: string; path: string; root: boolean }[] = [];
  const visit = (project: WorkspaceEntry, path: string, key: string) => {
    if (!isOpen(key)) return;
    openDirectories.push({ key, projectId: project.id, path, root: key === project.id });
    const listing = queryClient.getQueryData<RemoteDirectoryEntry[]>([
      ...directoryQueries,
      project.id,
      path,
    ]);
    for (const child of listing ?? [])
      if (child.directory) visit(project, child.path, keyOf(project, child.path));
  };
  for (const project of projects) visit(project, trimSlash(project.path!), project.id);

  // 收起即丢弃（gcTime 0）：再展开就是用户手动刷新的一层，失败也在重新展开时重试。
  const results = useQueries({
    queries: openDirectories.map(({ projectId, path, root }) => ({
      queryKey: [...directoryQueries, projectId, path],
      gcTime: 0,
      // 项目根这一层就是「连接」：冷启动（探测+上传+启动+隧道+握手）全在这里等，
      // 所以在状态里报出来，让面板与悬浮提示说的是同一件事。重复读取也照报——
      // 面板只在「没有任何内容」时才画过渡，热通道那几十毫秒够不到 200ms 的门槛。
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (root) setPhase(projectId, 'connecting');
        try {
          const items = await workspaceClient.listRemoteDirectory({ projectId, path });
          if (root && !signal.aborted) setPhase(projectId, 'ready');
          return items;
        } catch (cause) {
          const reason = `读取失败 ${path}：${errorText(cause)}`;
          if (root && !signal.aborted) setPhase(projectId, 'failed', reason);
          throw new Error(reason);
        }
      },
    })),
  });
  const listings: Record<string, RemoteDirectoryEntry[]> = {};
  for (const [index, { key }] of openDirectories.entries()) {
    const data = results[index]?.data;
    if (data) listings[key] = data;
  }

  const watchKey = openDirectories
    .map(({ projectId, path }) => `${projectId}\t${path}`)
    .sort()
    .join('\n');
  useEffect(() => {
    const byProject = new Map<string, string[]>();
    for (const { projectId, path } of openDirectories)
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), path].sort());
    watcher.report(byProject);
  }, [watcher, watchKey]);
  useEffect(() => watcher.dispose, [watcher]);

  // 远端工具写过文件、跑过 bash，或远端自己变了（watch）：这层自己变了，或它下面的目录变了
  // ——新条目要现出来，受影响的展开目录重读。
  useEffect(() => {
    const changed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onWorkspaceEvent('remoteChange', (path) => {
      changed.add(trimSlash(path));
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const paths = [...changed];
        changed.clear();
        void queryClient.invalidateQueries({
          queryKey: directoryQueries,
          predicate: ({ queryKey }) =>
            paths.some((changedPath) => withinChange(queryKey[3] as string, changedPath)),
        });
      }, CHANGE_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [queryClient]);

  const items: ExplorerItem[] = [];
  for (const project of projects) {
    if (!isOpen(project.id)) continue;
    const destination = project.remoteId ? destinations[project.remoteId] : undefined;
    // 与项目行的云朵取同一个连接色：同一台服务器的行看起来是一家人。
    const accent = remoteAccent(project.remoteId, 'text');
    const walk = (path: string, parentId: string | null) => {
      for (const child of listings[keyOf(project, path)] ?? []) {
        if (hiddenWorkspaceNames.has(child.name)) continue;
        const childKey = remoteNodeId(project.id, child.path);
        items.push({
          id: childKey,
          parentId,
          name: child.name,
          container: child.directory,
          readOnly: true,
          // 远端目录接收本地文件拖放（上传）；内部移动仍被 readOnly 拦住。
          importable: child.directory,
          accent,
          title: remoteTitle(destination, child.path),
        });
        if (child.directory && expanded.includes(childKey)) walk(child.path, childKey);
      }
    };
    walk(trimSlash(project.path!), project.id === rootId ? null : project.id);
  }

  // 只报失败：读取中的提示会在每次展开/收起时插进、抽走一行，整棵树跟着上下跳。
  const status = results.find((result) => result.isError)?.error.message ?? null;

  // 不可用提示按目的地对准：这棵树里有项目连着那台服务器才显示，消息里带上目的地。
  // 多条通道各自不可用时，一台恢复只让它自己那条从快照里消失，别的提示不受影响。
  // 不可用优先于重连中：两台服务器各在一种状态时，先说用不了的那台。
  const visible = channels.filter((channel) =>
    projects.some((project) => destinations[project.remoteId!] === channel.destination),
  );
  const unavailable = visible.find((channel) => channel.state === 'unavailable');
  const reconnecting = visible.find((channel) => channel.state === 'reconnecting');
  const degradedText = unavailable
    ? `${unavailable.destination} 的远程项目暂时不可用：${unavailable.reason}`
    : reconnecting
      ? `与 ${reconnecting.destination} 的连接中断，正在重连；远端正在运行的命令不受影响`
      : null;

  // 首次连接这台服务器时整棵树还没有内容：面板给一个过渡，而不是空着让人以为没有文件。
  // 逐层展开的读取几十毫秒就回来（还有内容在），不在这里报——那会让树上下跳。
  const connecting = rootActivity?.phase === 'connecting' && items.length === 0;

  return { items, destinations, status, degraded: degradedText, connecting };
}
