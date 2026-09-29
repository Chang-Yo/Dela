import type { SearchApi } from '../shared/api';
import { invoke } from './lib';

export const search = {
  query: (query: string) => invoke('search:query', query),
} satisfies SearchApi;
