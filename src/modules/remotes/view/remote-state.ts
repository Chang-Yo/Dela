// 远程连接在渲染端的共享状态：连接与候选走查询缓存，通道状态与部署日志来自主进程的推送，
// 面板与设置页读同一份。主目录只在本次运行内有效：远端是唯一事实来源，跨重启缓存会过期。
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { RemoteChannelState, RemoteSetupProgress, SshConfigHost } from '../contract';
import { onRemotesEvent, remotesClient } from './client';

interface RemoteState {
  /** 目的地 → 通道状态：最近一次推送的快照；还没推送过时为 null，改读 helperStates 的结果。 */
  pushedChannels: Record<string, RemoteChannelState> | null;
  /** 目的地 → 远端主目录（连上时由 helper 带回）。 */
  homes: Record<string, string>;
  /** 最近一次连接过程的逐行日志；进度推送本身不带目的地。 */
  setupLog: RemoteSetupProgress[];
  setHome: (destination: string, home: string) => void;
  clearSetupLog: () => void;
}

const byDestination = (states: RemoteChannelState[]) =>
  Object.fromEntries(states.map((state) => [state.destination, state]));

export const useRemoteState = create<RemoteState>((set, get) => ({
  pushedChannels: null,
  homes: {},
  setupLog: [],
  setHome(destination, home) {
    if (get().homes[destination] !== home) set({ homes: { ...get().homes, [destination]: home } });
  },
  clearSetupLog() {
    set({ setupLog: [] });
  },
}));

onRemotesEvent('helperState', (states) =>
  useRemoteState.setState({ pushedChannels: byDestination(states) }),
);
onRemotesEvent('setupProgress', (progress) =>
  useRemoteState.setState((state) => ({ setupLog: [...state.setupLog, progress] })),
);

export const remoteConnectionsQuery = queryOptions({
  queryKey: ['remotes', 'list'],
  queryFn: () => remotesClient.list(),
});

// 候选读不到（没有 config、权限不足）只是少几项，不影响已保存的连接。
export const sshConfigHostsQuery = queryOptions({
  queryKey: ['remotes', 'configHosts'],
  queryFn: () => remotesClient.configHosts().catch(() => [] as SshConfigHost[]),
});

const helperStatesQuery = queryOptions({
  queryKey: ['remotes', 'helperStates'],
  queryFn: () => remotesClient.helperStates(),
  select: byDestination,
});

const noChannels: Record<string, RemoteChannelState> = {};

/** 推送只报变化，所以先读一次当前快照；之后以推送为准。 */
export function useRemoteChannels(enabled = true): Record<string, RemoteChannelState> {
  const snapshot = useQuery({ ...helperStatesQuery, enabled });
  const pushed = useRemoteState((state) => state.pushedChannels);
  return pushed ?? snapshot.data ?? noChannels;
}

/** 连接增删后，连接列表与 ssh config 候选（已保存的主机会从候选里消失）都要重读。 */
export function refreshRemoteConnections(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: remoteConnectionsQuery.queryKey }),
    client.invalidateQueries({ queryKey: sshConfigHostsQuery.queryKey }),
  ]);
}

/** 状态点：未连接（灰）、可用（绿）、连接中/重连中（橙）、不可用（红）。 */
export function channelDot(state: RemoteChannelState | undefined): {
  className: string;
  label: string;
} {
  switch (state?.state) {
    case 'ready':
      return { className: 'bg-success', label: '可用' };
    case 'connecting':
      return { className: 'bg-warning animate-pulse motion-reduce:animate-none', label: '连接中' };
    case 'reconnecting':
      return { className: 'bg-warning animate-pulse motion-reduce:animate-none', label: '重连中' };
    case 'unavailable':
      return { className: 'bg-danger', label: '不可用' };
    default:
      return { className: 'bg-ink-3/50', label: '未连接' };
  }
}
