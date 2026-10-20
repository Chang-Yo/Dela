// 已保存的 ssh 连接（id → 连接），供目录树、项目行与资源管理器标题共用，避免三处各拉一遍。
// key 是「这次要用到哪些连接」；新增/删除连接必定改变 remoteId 集合，所以 key 变化即重拉，无需另做失效。
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
