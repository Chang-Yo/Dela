// 远程项目在文件树里的懒加载：展开一层拉一层，结果只留在组件状态里——远端是这些条目的唯一事实来源。
// 子条目 id 带项目身份（remoteNodeId）：只用路径会让两台连接上的同路径目录串成同一个节点。
import { useEffect, useRef, useState } from 'react';
import type { RemoteChannelState, RemoteDirectoryEntry, WorkspaceEntry } from '../../shared/api';
import { remoteNodeId } from '../../shared/remotes';
import { hiddenWorkspaceNames } from '../../shared/workspace';
import type { ExplorerItem } from '../components/ui/explorer';
import { errorText } from '../workspace/store';
import { useRemoteActivity } from './remote-activity';
import { remoteAccent } from './remote-color';
import { useRemoteConnections } from './remote-connections';

/** 项目根的 path 可能带尾斜杠，远端子路径一律不带：统一后再作缓存与展开键。 */
const trimSlash = (path: string) => path.replace(/\/+$/, '');

/** 远端变化通知的合并窗口：一次工具调用常连写几个文件，攒一下再重读，别一文件一请求。 */
const CHANGE_DEBOUNCE_MS = 300;

/** 上报 watch 的合并窗口：展开/收起常成串发生，攒一下只报最终集合。 */
const WATCH_DEBOUNCE_MS = 150;

/** 是否落在变化目录之内（含它自己）：这些清单都要重读。 */
const withinChange = (path: string, changed: string) =>
  path === changed || path.startsWith(`${changed}/`);

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
  const [listings, setListings] = useState<Record<string, RemoteDirectoryEntry[]>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const setPhase = useRemoteActivity((state) => state.setPhase);
  const rootActivity = useRemoteActivity((state) => (rootId ? state.byProject[rootId] : undefined));
  // 连接列表按「这棵树里涉及哪些连接」拉一次：目的地既给行提示，也给项目行与面板标题的悬浮提示。
  const remoteIdsKey = entries
    .filter((entry) => entry.kind === 'project' && entry.remoteId)
    .map((entry) => entry.remoteId)
    .join('|');
  const connections = useRemoteConnections(remoteIdsKey);
  const destinations = Object.fromEntries(
    Object.entries(connections).map(([id, connection]) => [id, connection.host]),
  );
  const [channels, setChannels] = useState<RemoteChannelState[]>([]);
  const inFlight = useRef(new Set<string>());
  /** 已缓存清单：远端路径供变化通知判断过期，项目 id 供上报 watch 分组。 */
  const listed = useRef(new Map<string, { projectId: string; path: string }>());
  const changed = useRef(new Set<string>());
  const flushTimer = useRef<number | undefined>(undefined);
  /** 已经报给主进程的监视集合（项目 id → 路径列表）：没变就不重报。 */
  const watching = useRef(new Map<string, string>());
  const watchTimer = useRef<number | undefined>(undefined);
  /** 项目自身的展开键与打开的项目 id 等价：项目打开时它必然展开，行本身不在树里。 */
  const isOpen = (key: string) => key === rootId || expanded.includes(key);

  const projects = entries.filter(
    (entry) => entry.kind === 'project' && entry.remoteId && entry.path,
  );
  /** 远端目录在树里的键：项目根用条目 id（与树里项目行一致），子目录带上项目身份。
   *  归属只由「从哪个项目走下来」决定，远端路径本身不再参与跨项目的解释。 */
  const keyOf = (project: WorkspaceEntry, path: string) =>
    trimSlash(project.path!) === path ? project.id : remoteNodeId(project.id, path);
  /** 项目 id → 远端根：只有项目根这一层的读取代表「这台连接能不能用」（连服务器就发生在这里）。 */
  const rootPaths = new Map(projects.map((project) => [project.id, trimSlash(project.path!)]));

  const openKeys = new Set<string>();
  const pending: { key: string; projectId: string; path: string }[] = [];
  const visit = (project: WorkspaceEntry, path: string, key: string) => {
    if (!isOpen(key)) return;
    openKeys.add(key);
    const listing = listings[key];
    if (!listing) {
      if (!failed[key]) pending.push({ key, projectId: project.id, path });
      return;
    }
    for (const child of listing)
      if (child.directory) visit(project, child.path, keyOf(project, child.path));
  };
  for (const project of projects) visit(project, trimSlash(project.path!), project.id);

  const hasRemote = projects.length > 0;

  // helper 通道状态由主进程推整份快照：只提示对得上目的地的项目，别的服务器不打扰这棵树。
  useEffect(() => {
    const remotes = window.dela?.remotes;
    if (!hasRemote || !remotes?.onHelperState) return;
    return remotes.onHelperState(setChannels);
  }, [hasRemote]);

  // 收起时清掉失败记录：再次展开重试一次，避免一次网络抖动后目录永久打不开。
  // 同理丢掉收起目录的清单与它的 watch：收起再展开就是用户手动刷新的一层。
  // 依赖用内容而不是集合本身：每次渲染都是新集合，直接入依赖会让副作用每帧都跑。
  const openKey = [...openKeys].sort().join('\n');
  useEffect(() => {
    for (const key of [...listed.current.keys()])
      if (!openKeys.has(key)) listed.current.delete(key);
    setFailed((prev) => {
      const stale = Object.keys(prev).filter((key) => !openKeys.has(key));
      if (!stale.length) return prev;
      const next = { ...prev };
      for (const key of stale) delete next[key];
      return next;
    });
    setListings((prev) => {
      const stale = Object.keys(prev).filter((key) => !openKeys.has(key));
      if (!stale.length) return prev;
      const next = { ...prev };
      for (const key of stale) delete next[key];
      return next;
    });
  }, [openKey]);

  // 展开的远端目录报给主进程做 watch：Dela 之外改的远端文件因此也能自己出现在树里。
  // 合并窗口内攒着发，序列化后没变就不重报；不再展开的项目补一次空集合取消监视。
  useEffect(() => {
    const workspace = window.dela?.workspace;
    if (!workspace?.watchRemoteDirectories) return;
    // 只在没有待发窗口时起一个：这个 effect 每次渲染都会跑，反复重置会让它永远发不出去。
    if (watchTimer.current !== undefined) return;
    watchTimer.current = window.setTimeout(() => {
      watchTimer.current = undefined;
      // 集合同在窗口结束时才读：这 150ms 里有清单刚拉回来，提前读会漏掉它们。
      const byProject = new Map<string, Set<string>>();
      for (const { projectId, path } of listed.current.values()) {
        const paths = byProject.get(projectId) ?? new Set<string>();
        paths.add(path);
        byProject.set(projectId, paths);
      }
      for (const projectId of watching.current.keys())
        if (!byProject.has(projectId)) byProject.set(projectId, new Set());
      for (const [projectId, paths] of byProject) {
        const wanted = [...paths].sort();
        const serialized = wanted.join('\n');
        if (watching.current.get(projectId) === serialized) continue;
        watching.current.set(projectId, serialized);
        void workspace.watchRemoteDirectories(projectId, wanted).catch((error: unknown) => {
          // 报不上去只是少了实时刷新：工具改动那条路照常，不打扰用户，但留一条线索。
          console.warn('[workspace] 上报远端监视目录失败', error);
          watching.current.delete(projectId);
        });
      }
    }, WATCH_DEBOUNCE_MS);
  });

  // 树卸载（项目关掉、切走视图）时取消监视：远端不该继续为看不见的目录留 inotify watch。
  // 待发的窗口也必须一起清掉：它在卸载后才触发时会把旧集合重报一遍，等于白取消。
  useEffect(
    () => () => {
      if (watchTimer.current !== undefined) {
        clearTimeout(watchTimer.current);
        watchTimer.current = undefined;
      }
      listed.current.clear();
      const workspace = window.dela?.workspace;
      for (const projectId of watching.current.keys())
        void workspace?.watchRemoteDirectories(projectId, []).catch(() => {});
      watching.current.clear();
    },
    [],
  );

  // 远端工具写过文件、跑过 bash，或远端自己变了（watch）：丢掉受影响的清单（这层自己变了，
  // 或它下面的目录变了——新条目要现出来），缺清单的展开目录由下面那个 effect 自动重拉。
  useEffect(() => {
    const workspace = window.dela?.workspace;
    if (!workspace?.onRemoteChange) return;
    return workspace.onRemoteChange((path) => {
      changed.current.add(trimSlash(path));
      if (flushTimer.current !== undefined) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined;
        const paths = [...changed.current];
        changed.current.clear();
        const stale = new Set<string>();
        for (const [key, { path: listedPath }] of listed.current)
          if (paths.some((changedPath) => withinChange(listedPath, changedPath))) stale.add(key);
        if (!stale.size) return;
        for (const key of stale) listed.current.delete(key);
        const drop = <T>(prev: Record<string, T>) =>
          Object.fromEntries(Object.entries(prev).filter(([key]) => !stale.has(key)));
        setListings(drop);
        setFailed(drop);
      }, CHANGE_DEBOUNCE_MS);
    });
  }, []);

  useEffect(() => {
    const workspace = window.dela?.workspace;
    if (!workspace) return;
    for (const node of pending) {
      if (inFlight.current.has(node.key)) continue;
      inFlight.current.add(node.key);
      // 这一层的「作废标记」：清单被丢掉（收起、或远端变化）之后，在途的旧响应不能把旧内容写回来。
      const marker = { projectId: node.projectId, path: node.path };
      listed.current.set(node.key, marker);
      // 项目根这一层就是「连接」：冷启动（探测+上传+启动+隧道+握手）全在这里等，
      // 所以在状态里报出来，让面板与悬浮提示说的是同一件事。重复读取也照报——
      // 面板只在「没有任何内容」时才画过渡，热通道那几十毫秒够不到 200ms 的门槛。
      const root = rootPaths.get(node.projectId) === node.path;
      if (root) setPhase(node.projectId, 'connecting');
      void workspace
        .listRemoteDirectory(node.projectId, node.path)
        .then(
          (items) => {
            if (listed.current.get(node.key) !== marker) return;
            if (root) setPhase(node.projectId, 'ready');
            setListings((prev) => ({ ...prev, [node.key]: items }));
          },
          (cause) => {
            if (listed.current.get(node.key) !== marker) return;
            const reason = `读取失败 ${node.path}：${errorText(cause)}`;
            if (root) setPhase(node.projectId, 'failed', reason);
            setFailed((prev) => ({ ...prev, [node.key]: reason }));
          },
        )
        .finally(() => {
          inFlight.current.delete(node.key);
        });
    }
  });

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
  const status = Object.values(failed)[0] ?? null;

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
