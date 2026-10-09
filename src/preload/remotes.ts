import type {
  RemoteApi,
  RemoteBrowseResult,
  RemoteConnection,
  RemoteProbe,
} from '../shared/remotes';
import { invoke } from './lib';

export const remotes: RemoteApi = {
  list: () => invoke('remotes:list') as Promise<RemoteConnection[]>,
  save: (draft) => invoke('remotes:save', draft) as Promise<RemoteConnection>,
  remove: (id) => invoke('remotes:remove', id) as Promise<void>,
  probe: (draft) => invoke('remotes:probe', draft) as Promise<RemoteProbe>,
  browse: (draft, path) => invoke('remotes:browse', draft, path) as Promise<RemoteBrowseResult>,
};
