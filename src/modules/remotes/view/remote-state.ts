// 远程连接在渲染端的共享状态：已保存的连接、ssh config 候选与各通道的实时状态，面板与设置页读同一份。
// 目录缓存只在本次运行内有效：远端是唯一事实来源，跨重启缓存会给出过期的目录。
import { create } from 'zustand';
import type {
  RemoteBrowseResult,
  RemoteChannelState,
  RemoteConnection,
  SshConfigHost,
} from '../contract';
import { onRemotesEvent, remotesClient } from './client';

interface RemoteState {
  connections: RemoteConnection[] | null;
  candidates: SshConfigHost[];
  /** 目的地 → 通道状态（主进程推送的快照）。 */
  channels: Record<string, RemoteChannelState>;
  /** 目的地 → 远端主目录（连上时由 helper 带回）。 */
  homes: Record<string, string>;
  /** `目的地|路径` → 子目录清单：返回上一级、再进来都不必重新等。 */
  listings: Record<string, RemoteBrowseResult>;
  load: () => Promise<void>;
  setHome: (destination: string, home: string) => void;
  cacheListing: (destination: string, listing: RemoteBrowseResult) => void;
}

const byDestination = (states: RemoteChannelState[]) =>
  Object.fromEntries(states.map((state) => [state.destination, state]));

export const useRemoteState = create<RemoteState>((set, get) => ({
  connections: null,
  candidates: [],
  channels: {},
  homes: {},
  listings: {},
  async load() {
    if (!window.dela) {
      set({ connections: [], candidates: [] });
      return;
    }
    // 候选读不到（没有 config、权限不足）只是少几项，不影响已保存的连接。
    // 通道状态的推送只报变化，这里补拉一次当前快照。
    const [connections, candidates, states] = await Promise.all([
      remotesClient.list(),
      remotesClient.configHosts().catch(() => [] as SshConfigHost[]),
      remotesClient.helperStates(),
    ]);
    set({ connections, candidates, channels: byDestination(states) });
  },
  setHome(destination, home) {
    if (get().homes[destination] !== home) set({ homes: { ...get().homes, [destination]: home } });
  },
  cacheListing(destination, listing) {
    set({ listings: { ...get().listings, [`${destination}|${listing.path}`]: listing } });
  },
}));

onRemotesEvent('helperState', (states) =>
  useRemoteState.setState({ channels: byDestination(states) }),
);

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
