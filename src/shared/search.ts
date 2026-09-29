import type { SettingsSectionId } from './settings';

export type GlobalSearchResult = {
  title: string;
  subtitle: string | null;
} & (
  | { kind: 'project'; id: string; target: { page: 'projects'; entryId: string } }
  | { kind: 'chat'; id: string; target: { page: 'chat'; scope: string; sessionId: string } }
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
