import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type { NavTarget } from '../../app/module';

/** 每个来源最多返回的条数。 */
export const SEARCH_LIMIT = 10;

/** 分组图标：搜索界面自己的图标词表，来源从中挑选，界面因此不必认识各个模块。 */
export type SearchIcon = 'folder' | 'message' | 'mail' | 'file' | 'check' | 'settings';

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  target: NavTarget;
}

export interface SearchGroup {
  id: string;
  label: string;
  icon: SearchIcon;
  /** 达到条数上限，界面据此提示还有更多。 */
  truncated: boolean;
  hits: SearchHit[];
}

export const searchContract = defineContract('search', {
  query: { input: z.string().trim().max(200), output: z.custom<SearchGroup[]>() },
});
