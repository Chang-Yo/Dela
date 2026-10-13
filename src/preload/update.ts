import type { UpdateApi, UpdateSnapshot } from '../shared/update';
import { invoke, on } from './lib';

export const update = {
  getState: () => invoke('update:get-state'),
  check: () => invoke('update:check'),
  download: () => invoke('update:download'),
  install: () => invoke('update:install'),
  deferInstall: () => invoke('update:defer-install'),
  openDownloadPage: () => invoke('update:open-download-page'),
  onState: (listener: (state: UpdateSnapshot) => void) =>
    on<UpdateSnapshot>('update:state', listener),
} satisfies UpdateApi;
