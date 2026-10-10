import type {
  HelperDegradation,
  RemoteApi,
  RemoteBrowseResult,
  RemoteConnection,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
} from '../shared/remotes';
import { invoke, on } from './lib';

export const remotes: RemoteApi = {
  list: () => invoke('remotes:list') as Promise<RemoteConnection[]>,
  save: (draft) => invoke('remotes:save', draft) as Promise<RemoteConnection>,
  remove: (id) => invoke('remotes:remove', id) as Promise<void>,
  probe: (draft) => invoke('remotes:probe', draft) as Promise<RemoteProbe>,
  browse: (draft, path) => invoke('remotes:browse', draft, path) as Promise<RemoteBrowseResult>,
  pickKey: () => invoke('remotes:pick-key') as Promise<string | null>,
  prepare: (draft) => invoke('remotes:prepare', draft) as Promise<RemotePrepare>,
  onSetupProgress: (listener) => on<RemoteSetupProgress>('remotes:setup-progress', listener),
  onHelperState: (listener) => on<HelperDegradation[]>('remotes:helper-state', listener),
};
