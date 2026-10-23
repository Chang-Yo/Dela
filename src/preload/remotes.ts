import type {
  RemoteApi,
  RemoteBrowseResult,
  RemoteChannelState,
  RemoteConnection,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
  RemoteTask,
  SshConfigHost,
} from '../shared/remotes';
import { invoke, on } from './lib';

export const remotes: RemoteApi = {
  list: () => invoke('remotes:list') as Promise<RemoteConnection[]>,
  save: (draft) => invoke('remotes:save', draft) as Promise<RemoteConnection>,
  remove: (id) => invoke('remotes:remove', id) as Promise<void>,
  probe: (draft) => invoke('remotes:probe', draft) as Promise<RemoteProbe>,
  browse: (draft, path) => invoke('remotes:browse', draft, path) as Promise<RemoteBrowseResult>,
  mkdir: (draft, parent, name) => invoke('remotes:mkdir', draft, parent, name) as Promise<string>,
  pickKey: () => invoke('remotes:pick-key') as Promise<string | null>,
  configHosts: () => invoke('remotes:config-hosts') as Promise<SshConfigHost[]>,
  prepare: (draft) => invoke('remotes:prepare', draft) as Promise<RemotePrepare>,
  onSetupProgress: (listener) => on<RemoteSetupProgress>('remotes:setup-progress', listener),
  onHelperState: (listener) => {
    const stop = on<RemoteChannelState[]>('remotes:helper-state', listener);
    // 推送只报变化：订阅时补拉一次当前快照，晚挂上的界面也能看到已经不可用的通道。
    void (invoke('remotes:helper-states') as Promise<RemoteChannelState[]>).then(listener);
    return stop;
  },
  tasks: (remoteId) => invoke('remotes:tasks', remoteId) as Promise<RemoteTask[]>,
  cancelTask: (remoteId, taskId) =>
    invoke('remotes:cancel-task', remoteId, taskId) as Promise<void>,
  retry: (remoteId) => invoke('remotes:retry', remoteId) as Promise<RemoteChannelState>,
};
