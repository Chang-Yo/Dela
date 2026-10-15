import type { CacheApi } from '../shared/cache';
import { invoke } from './lib';

export const cache = {
  getSize: () => invoke('cache:get-size'),
  clear: () => invoke('cache:clear'),
} satisfies CacheApi;
