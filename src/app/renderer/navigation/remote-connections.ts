// 已保存的 ssh 连接（id → 连接），目录树、项目行与资源管理器标题共用同一份缓存。
import { useQuery } from '@tanstack/react-query';
import type { RemoteConnection } from '../../../modules/remotes/contract';
import { remoteConnectionsQuery } from '../../../modules/remotes/view';

const byId = (list: RemoteConnection[]) => Object.fromEntries(list.map((item) => [item.id, item]));
const noConnections: Record<string, RemoteConnection> = {};

/** 读不到连接列表只是少一行提示，树与项目行照常可用。 */
export function useRemoteConnections(): Record<string, RemoteConnection> {
  return useQuery({ ...remoteConnectionsQuery, select: byId }).data ?? noConnections;
}

export function remoteDestination(connection: RemoteConnection | undefined): string | undefined {
  if (!connection) return undefined;
  return connection.port ? `${connection.host}:${connection.port}` : connection.host;
}
