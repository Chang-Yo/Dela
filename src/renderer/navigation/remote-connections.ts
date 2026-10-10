// 已保存的 ssh 连接（id → 连接）：目录树的行提示、项目行与资源管理器标题的悬浮提示都要「目的地」，
// 三处共用这一个 hook，不再各自拉一遍。key 是「这次要用到哪些连接」，变了就重拉——
// 新增/删除连接一定伴随 remoteId 集合变化，所以不必再单独做作废。
import { useEffect, useState } from 'react';
import type { RemoteConnection } from '../../shared/remotes';

export function useRemoteConnections(key: string): Record<string, RemoteConnection> {
  const [connections, setConnections] = useState<Record<string, RemoteConnection>>({});
  useEffect(() => {
    let live = true;
    const remotes = window.dela?.remotes;
    if (!remotes) return;
    void remotes.list().then(
      (list) => {
        if (live) setConnections(Object.fromEntries(list.map((item) => [item.id, item])));
      },
      () => {
        /* 读不到连接列表只是少一行提示，树与项目行照常可用。 */
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  return connections;
}

/** 目的地（行提示与悬浮提示共用的写法）：端口只在显式指定时带上。 */
export function remoteDestination(connection: RemoteConnection | undefined): string | undefined {
  if (!connection) return undefined;
  return connection.port ? `${connection.host}:${connection.port}` : connection.host;
}
