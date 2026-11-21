import { likePattern, type SearchProvider } from '../../search';
import { hostPorts } from '../../../core/ports';
import { searchSessionTitles } from '../../../core/agent/session/store';

export const projectSearch: SearchProvider = {
  id: 'project',
  label: '本地项目',
  icon: 'folder',
  search(query, limit) {
    const filter = query ? "AND name LIKE ? ESCAPE '!'" : '';
    const rows = hostPorts()
      .database()
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

// 只按标题匹配：正文在 Pi 的 JSONL 会话文件里；子 Agent 会话只从父会话进入，不进搜索。
export const chatSearch: SearchProvider = {
  id: 'chat',
  label: '聊天对话',
  icon: 'message',
  search(query, limit) {
    const project = hostPorts()
      .database()
      .prepare("SELECT name FROM workspace_entries WHERE id=? AND kind='project'");
    return searchSessionTitles(query, limit).map((session) => ({
      id: session.id,
      title: session.title,
      subtitle:
        (session.projectId &&
          (project.get(session.projectId) as { name: string } | undefined)?.name) ||
        '首页',
      target: { page: 'chat', projectId: session.projectId, sessionId: session.id },
    }));
  },
};
