import type { SettingsSectionId } from './settings';

/** 全局搜索每类结果的上限：main 查询与弹窗「已截断」提示共用同一事实来源。 */
export const GLOBAL_SEARCH_PER_KIND_LIMIT = 10;

export type GlobalSearchResult = {
  title: string;
  subtitle: string | null;
} & (
  | { kind: 'project'; id: string; target: { page: 'projects'; entryId: string } }
  | {
      kind: 'chat';
      id: string;
      target: { page: 'chat'; projectId: string | null; sessionId: string };
    }
  | { kind: 'mail'; id: number; target: { page: 'mail'; messageId: number } }
  | { kind: 'todo'; id: string; target: { page: 'todo'; todoId: string } }
  | { kind: 'course-file'; id: string; target: { page: 'sources'; sourceId: string } }
  | {
      kind: 'setting';
      id: SettingsSectionId;
      target: { page: 'settings'; section: SettingsSectionId };
    }
);

export interface SearchApi {
  query(query: string): Promise<GlobalSearchResult[]>;
}
