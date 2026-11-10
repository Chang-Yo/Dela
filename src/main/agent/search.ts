import { likePattern, type SearchProvider } from '../../modules/search';
import { getDatabase } from '../database';

// 只按标题匹配：正文在 Pi 的 JSONL 会话文件里；子 Agent 会话只从父会话进入，不进搜索。
export const chatSearch: SearchProvider = {
  id: 'chat',
  label: '聊天对话',
  icon: 'message',
  search(query, limit) {
    const filter = query ? "AND sessions.title LIKE ? ESCAPE '!'" : '';
    const rows = getDatabase()
      .prepare(
        `SELECT sessions.id, sessions.project_id AS projectId, sessions.title,
           coalesce(project.name, '首页') AS projectName
         FROM sessions LEFT JOIN workspace_entries AS project
           ON project.id=sessions.project_id AND project.kind='project'
         WHERE sessions.parent_id IS NULL ${filter}
         ORDER BY sessions.updated_at DESC LIMIT ?`,
      )
      .all(...(query ? [likePattern(query)] : []), limit) as {
      id: string;
      projectId: string | null;
      title: string;
      projectName: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.projectName,
      target: { page: 'chat', projectId: row.projectId, sessionId: row.id },
    }));
  },
};
