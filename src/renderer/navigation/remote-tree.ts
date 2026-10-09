// 远程项目在文件树里的懒加载：展开一层拉一层（workspace.listRemoteDirectory），
// 结果只留在组件状态里，不写入 workspace 镜像——远端才是这些条目的唯一事实来源。
// 子条目 id 是「项目 id + 远端绝对路径」（shared/remotes 的 remoteNodeId）：只用路径
// 会让两台连接上的同路径目录串成同一个节点（清单、展开态、选中态都会混）。
import { useEffect, useRef, useState } from 'react';
import { Cloud } from 'lucide-react';
import type { RemoteDirectoryEntry, WorkspaceEntry } from '../../shared/api';
import { remoteNodeId } from '../../shared/remotes';
import type { ExplorerItem } from '../components/ui/explorer';
import { errorText } from '../workspace/store';

/** 项目根的 path 可能带尾斜杠，远端子路径一律不带：统一后再作缓存与展开键。 */
const trimSlash = (path: string) => path.replace(/\/+$/, '');

/** 远端条目的行提示：有连接信息时显示「目的地:路径」，否则退回路径。 */
export const remoteTitle = (destination: string | undefined, path: string) =>
  destination ? `${destination}:${trimSlash(path)}` : trimSlash(path);

export interface RemoteTree {
  /** 远端项目已缓存子目录对应的树节点（本地条目之外的部分）。 */
  items: ExplorerItem[];
  /** 远端连接 id → ssh 目的地；行提示用。 */
  destinations: Record<string, string>;
  /** 正在读取或读取失败的说明；无则 null。 */
  status: string | null;
}

/**
 * 传入的一律是当前这棵树里可见的条目（外加上 rootId 自身的条目）：同一份展开态被多棵树
 * 共用（我的内容 / 归档 / 打开的项目），不可见的远程项目不该触发远端请求。
 * rootId 是打开的项目 id：此时项目行不显示，它的远端内容直接落在树的顶层。
 */
export function useRemoteTree(
  entries: WorkspaceEntry[],
  expanded: string[],
  rootId: string | null,
): RemoteTree {
  const [listings, setListings] = useState<Record<string, RemoteDirectoryEntry[]>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  /** 项目自身的展开键与打开的项目 id 等价：项目打开时它必然展开，行本身不在树里。 */
  const isOpen = (key: string) => key === rootId || expanded.includes(key);

  const projects = entries.filter(
    (entry) => entry.kind === 'project' && entry.remoteId && entry.path,
  );
  /** 远端目录在树里的键：项目根用条目 id（与树里项目行一致），子目录带上项目身份。
   *  归属只由「从哪个项目走下来」决定，远端路径本身不再参与跨项目的解释。 */
  const keyOf = (project: WorkspaceEntry, path: string) =>
    trimSlash(project.path!) === path ? project.id : remoteNodeId(project.id, path);

  // 每个项目从自己的根往下走，收集仍展开的键与待拉取的目录。
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
  useEffect(() => {
    const remotes = window.dela?.remotes;
    if (!hasRemote || !remotes) return;
    let live = true;
    void remotes.list().then(
      (connections) => {
        if (live)
          setDestinations(
            Object.fromEntries(connections.map((connection) => [connection.id, connection.host])),
          );
      },
      () => {
        /* 读不到连接列表只是少一行提示，树本身照常可用。 */
      },
    );
    return () => {
      live = false;
    };
  }, [hasRemote]);

  // 收起时清掉失败记录：再次展开重试一次，避免一次网络抖动后目录永久打不开。
  // 同理丢掉收起目录的清单：远端没有文件监听，收起再展开就是用户手动刷新的一层。
  // 依赖用内容而不是集合本身：每次渲染都是新集合，直接入依赖会让副作用每帧都跑。
  const openKey = [...openKeys].sort().join('\n');
  useEffect(() => {
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

  // 展开的远端目录按需补齐：在途集合与失败记录保证不重复请求。
  useEffect(() => {
    const workspace = window.dela?.workspace;
    if (!workspace) return;
    for (const node of pending) {
      if (inFlight.current.has(node.key)) continue;
      inFlight.current.add(node.key);
      void workspace
        .listRemoteDirectory(node.projectId, node.path)
        .then(
          (items) => setListings((prev) => ({ ...prev, [node.key]: items })),
          (cause) =>
            setFailed((prev) => ({
              ...prev,
              [node.key]: `读取失败 ${node.path}：${errorText(cause)}`,
            })),
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
    const walk = (path: string, parentId: string | null) => {
      for (const child of listings[keyOf(project, path)] ?? []) {
        const childKey = remoteNodeId(project.id, child.path);
        items.push({
          id: childKey,
          parentId,
          name: child.name,
          container: child.directory,
          readOnly: true,
          marker: Cloud,
          title: remoteTitle(destination, child.path),
        });
        if (child.directory && expanded.includes(childKey)) walk(child.path, childKey);
      }
    };
    // 项目作为当前树根时不显示项目行，它的远端内容直接挂在顶层。
    walk(trimSlash(project.path!), project.id === rootId ? null : project.id);
  }

  const failure = Object.values(failed)[0];
  const loading = pending[0];
  const status = failure ?? (loading ? `正在读取 ${loading.path}…` : null);

  return { items, destinations, status };
}
