import { likePattern, type SearchProvider } from '../../modules/search';
import { getDatabase } from '../database';

export const projectSearch: SearchProvider = {
  id: 'project',
  label: '本地项目',
  icon: 'folder',
  search(query, limit) {
    const filter = query ? "AND name LIKE ? ESCAPE '!'" : '';
    const rows = getDatabase()
      .prepare(
        `SELECT id, name FROM workspace_entries WHERE kind='project' ${filter} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...(query ? [likePattern(query)] : []), limit) as { id: string; name: string }[];
    return rows.map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: null,
      target: { page: 'projects', entryId: row.id },
    }));
  },
};
