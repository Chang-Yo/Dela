// 远程连接在渲染端的共享状态：已保存的连接、ssh config 候选、各通道的实时状态，以及每台服务器
// 「上次停在哪个目录」。面板、设置页、目录树读同一份，避免各拉各的、互相对不上。
// 目录缓存只在本次运行内有效（远端是唯一事实来源，跨重启缓存会给出过期的目录）；
// 上次的位置是偏好，落 localStorage。
import { create } from 'zustand';
import type {
  RemoteBrowseResult,
  RemoteChannelState,
  RemoteConnection,
  SshConfigHost,
} from '../../../shared/api';

/** localStorage 键：每台服务器（按目的地）上次浏览到的目录。 */
const LAST_DIRECTORY_KEY = 'dela.remote.lastDirectory';

function readLastDirectories(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_DIRECTORY_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

interface RemoteState {
  connections: RemoteConnection[] | null;
  candidates: SshConfigHost[];
  /** 目的地 → 通道状态（主进程推送的快照）。 */
  channels: Record<string, RemoteChannelState>;
  /** 目的地 → 远端主目录（连上时由 helper 带回）。 */
  homes: Record<string, string>;
  /** `目的地|路径` → 子目录清单：返回上一级、再进来都不必重新等。 */
  listings: Record<string, RemoteBrowseResult>;
  lastDirectory: Record<string, string>;
  load: () => Promise<void>;
  setHome: (destination: string, home: string) => void;
  cacheListing: (destination: string, listing: RemoteBrowseResult) => void;
  rememberDirectory: (destination: string, path: string) => void;
}

/** 订阅一次主进程的通道推送；按 api 对象记，换了 window.dela（测试里）会重新订阅。 */
let subscribedTo: unknown = null;

export const useRemoteState = create<RemoteState>((set, get) => ({
  connections: null,
  candidates: [],
  channels: {},
  homes: {},
  listings: {},
  lastDirectory: readLastDirectories(),
  async load() {
    const remotes = window.dela?.remotes;
    if (!remotes) {
      set({ connections: [], candidates: [] });
      return;
    }
    if (subscribedTo !== remotes) {
      subscribedTo = remotes;
      remotes.onHelperState((states) =>
        set({ channels: Object.fromEntries(states.map((state) => [state.destination, state])) }),
      );
    }
    // 候选读不到（没有 config、权限不足）只是少几项，不影响已保存的连接。
    const [connections, candidates] = await Promise.all([
      remotes.list(),
      remotes.configHosts().catch(() => [] as SshConfigHost[]),
    ]);
    set({ connections, candidates });
  },
  setHome(destination, home) {
    if (get().homes[destination] !== home) set({ homes: { ...get().homes, [destination]: home } });
  },
  cacheListing(destination, listing) {
    set({ listings: { ...get().listings, [`${destination}|${listing.path}`]: listing } });
  },
  rememberDirectory(destination, path) {
    const lastDirectory = { ...get().lastDirectory, [destination]: path };
    set({ lastDirectory });
    try {
      localStorage.setItem(LAST_DIRECTORY_KEY, JSON.stringify(lastDirectory));
    } catch {
      // 存不了只是下次从主目录起步。
    }
  },
}));

/** 状态点：未连接（灰）、可用（绿）、连接中/重连中（橙）、不可用（红）。 */
export function channelDot(state: RemoteChannelState | undefined): {
  className: string;
  label: string;
} {
  switch (state?.state) {
    case 'ready':
      return { className: 'bg-green', label: '可用' };
    case 'connecting':
      return { className: 'bg-orange animate-pulse motion-reduce:animate-none', label: '连接中' };
    case 'reconnecting':
      return { className: 'bg-orange animate-pulse motion-reduce:animate-none', label: '重连中' };
    case 'unavailable':
      return { className: 'bg-red', label: '不可用' };
    default:
      return { className: 'bg-ink-3/50', label: '未连接' };
  }
}
