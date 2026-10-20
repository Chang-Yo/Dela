/**
 * 远端端口预览：端口清单只走 helper（一次性 ssh 解析 ss/netstat 方言不值得再造）；
 * 隧道是独立 ssh 进程，不随 helper 关闭，同一远端端口复用至显式停止或退出。
 */
import { shell } from 'electron';
import { openPortTunnel, helperSession, type PortTunnel } from './helper';
import { targetKey, type RemoteTarget } from './transport';
import type { RemotePortTunnel, RemotePortsState } from '../../shared/remotes';

interface TunnelEntry {
  key: string;
  destination: string;
  remotePort: number;
  tunnel: PortTunnel;
}

const tunnels = new Map<string, TunnelEntry>();

const tunnelKey = (target: RemoteTarget, remotePort: number) =>
  `${targetKey(target)}#${remotePort}`;

/** 端口清单 + 该目标当前已开的隧道：面板一次拿全。helper 不可用时抛错（面板展示原因）。 */
export async function remotePortsState(target: RemoteTarget): Promise<RemotePortsState> {
  const session = await helperSession(target);
  if (!session) throw new Error('端口预览需要 helper 通道：当前不可用，已退回一次性 ssh');
  const ports = await session.listPorts();
  const keyPrefix = `${targetKey(target)}#`;
  const active: RemotePortTunnel[] = [];
  for (const entry of tunnels.values())
    if (entry.key.startsWith(keyPrefix))
      active.push({ remotePort: entry.remotePort, localPort: entry.tunnel.localPort });
  return { ports, tunnels: active.sort((a, b) => a.remotePort - b.remotePort) };
}

export async function openRemotePort(target: RemoteTarget, remotePort: number): Promise<number> {
  const key = tunnelKey(target, remotePort);
  let entry = tunnels.get(key);
  if (!entry) {
    const tunnel = await openPortTunnel(target, remotePort);
    entry = { key, destination: target.host, remotePort, tunnel };
    tunnels.set(key, entry);
  }
  await shell.openExternal(`http://127.0.0.1:${entry.tunnel.localPort}`);
  return entry.tunnel.localPort;
}

export function closeRemotePort(target: RemoteTarget, remotePort: number): void {
  const entry = tunnels.get(tunnelKey(target, remotePort));
  if (!entry) return;
  tunnels.delete(entry.key);
  entry.tunnel.close();
}

/** 应用退出时的收尾：所有端口隧道都是本地 ssh 进程，直接杀。 */
export function closeAllPortTunnels(): void {
  for (const entry of tunnels.values()) entry.tunnel.close();
  tunnels.clear();
}
