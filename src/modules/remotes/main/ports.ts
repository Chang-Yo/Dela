/**
 * 远端端口预览：端口清单来自 helper；隧道是独立 ssh 进程，不随 helper 通道重连或关闭，
 * 同一远端端口复用至显式停止或退出。
 */
import { shell } from 'electron';
import { openPortTunnel, helperSession, type PortTunnel } from '../../../core/remote/helper';
import { targetKey, type RemoteTarget } from '../../../core/remote/transport';
import type { RemotePortTunnel, RemotePortsState } from '../contract';

interface TunnelEntry {
  key: string;
  destination: string;
  remotePort: number;
  tunnel: PortTunnel;
}

const tunnels = new Map<string, TunnelEntry>();

const tunnelKey = (target: RemoteTarget, remotePort: number) =>
  `${targetKey(target)}#${remotePort}`;

export async function remotePortsState(target: RemoteTarget): Promise<RemotePortsState> {
  const ports = await helperSession(target).listPorts();
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

export function closeAllPortTunnels(): void {
  for (const entry of tunnels.values()) entry.tunnel.close();
  tunnels.clear();
}
