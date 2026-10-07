import type { SponsorsApi } from '../shared/sponsors';
import { invoke } from './lib';

export const sponsors = {
  getState: () => invoke('sponsors:get-state'),
  refresh: () => invoke('sponsors:refresh'),
  refreshNow: () => invoke('sponsors:refresh-now'),
  openSupportPage: () => invoke('sponsors:open-support-page'),
} satisfies SponsorsApi;
