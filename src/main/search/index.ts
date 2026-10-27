import { ipcMain } from 'electron';
import { z } from 'zod';
import { GLOBAL_SEARCH_PER_KIND_LIMIT, type GlobalSearchResult } from '../../shared/search';
import { getTodoState } from '../todo';
import { todoStatusLabels } from '../../shared/todo';
import { getDatabase } from '../database';
import { checkWorkspaceSender } from '../ipc';

const querySchema = z.string().trim().max(200);
const perKindLimit = GLOBAL_SEARCH_PER_KIND_LIMIT;

function likePattern(query: string): string {
  return `%${query.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
}

type ProjectRow = { id: string; title: string; updatedAt: string };
type ChatRow = {
  id: string;
  projectId: string | null;
  title: string;
  subtitle: string;
  updatedAt: string;
};
type MailRow = {
  id: number;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  snippet: string | null;
  date: string | null;
};
type CanvasFileRow = { id: string; title: string; courseName: string | null };

/**
 * Searches only data already stored in Dela's SQLite database. In particular,
 * Canvas files are matched by their cached title and never downloaded here.
 */
export function queryGlobalSearch(query: string): GlobalSearchResult[] {
  const db = getDatabase();
  const pattern = likePattern(query);
  const projects = (
    query
      ? db
          .prepare(
            "SELECT id, name AS title, updated_at AS updatedAt FROM workspace_entries WHERE kind='project' AND name LIKE ? ESCAPE '!' ORDER BY updated_at DESC LIMIT ?",
          )
          .all(pattern, perKindLimit)
      : db
          .prepare(
            "SELECT id, name AS title, updated_at AS updatedAt FROM workspace_entries WHERE kind='project' ORDER BY updated_at DESC LIMIT ?",
          )
          .all(perKindLimit)
  ) as ProjectRow[];
  // 只按会话标题匹配：正文在 Pi 的 JSONL 会话文件里，sessions 表没有消息列。
  const chats = (
    query
      ? db
          .prepare(
            "SELECT sessions.id, sessions.project_id AS projectId, sessions.title, coalesce(project.name, '首页') AS subtitle, sessions.updated_at AS updatedAt FROM sessions LEFT JOIN workspace_entries AS project ON project.id=sessions.project_id AND project.kind='project' WHERE sessions.title LIKE ? ESCAPE '!' ORDER BY sessions.updated_at DESC LIMIT ?",
          )
          .all(pattern, perKindLimit)
      : db
          .prepare(
            "SELECT sessions.id, sessions.project_id AS projectId, sessions.title, coalesce(project.name, '首页') AS subtitle, sessions.updated_at AS updatedAt FROM sessions LEFT JOIN workspace_entries AS project ON project.id=sessions.project_id AND project.kind='project' ORDER BY sessions.updated_at DESC LIMIT ?",
          )
          .all(perKindLimit)
  ) as ChatRow[];
  const mail = (
    query
      ? db
          .prepare(
            "SELECT id, subject, sender_name AS senderName, sender_address AS senderAddress, snippet, date FROM mail_messages WHERE deleted_at IS NULL AND (subject LIKE ? ESCAPE '!' OR sender_name LIKE ? ESCAPE '!' OR sender_address LIKE ? ESCAPE '!' OR snippet LIKE ? ESCAPE '!' OR body_text LIKE ? ESCAPE '!') ORDER BY date DESC LIMIT ?",
          )
          .all(pattern, pattern, pattern, pattern, pattern, perKindLimit)
      : db
          .prepare(
            'SELECT id, subject, sender_name AS senderName, sender_address AS senderAddress, snippet, date FROM mail_messages WHERE deleted_at IS NULL ORDER BY date DESC LIMIT ?',
          )
          .all(perKindLimit)
  ) as MailRow[];
  const files = (
    query
      ? db
          .prepare(
            "SELECT canvas_sources.id, json_extract(canvas_sources.data, '$.title') AS title, json_extract(canvas_courses.data, '$.name') AS courseName FROM canvas_sources LEFT JOIN canvas_courses ON canvas_courses.id=canvas_sources.course_id WHERE json_extract(canvas_sources.data, '$.kind')='file' AND json_extract(canvas_sources.data, '$.title') LIKE ? ESCAPE '!' ORDER BY canvas_sources.id LIMIT ?",
          )
          .all(pattern, perKindLimit)
      : db
          .prepare(
            "SELECT canvas_sources.id, json_extract(canvas_sources.data, '$.title') AS title, json_extract(canvas_courses.data, '$.name') AS courseName FROM canvas_sources LEFT JOIN canvas_courses ON canvas_courses.id=canvas_sources.course_id WHERE json_extract(canvas_sources.data, '$.kind')='file' ORDER BY canvas_sources.id LIMIT ?",
          )
          .all(perKindLimit)
  ) as CanvasFileRow[];

  const todos = getTodoState()
    .items.filter((item) =>
      `${item.title} ${item.notes} ${item.courseName ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .slice(0, perKindLimit);
  return [
    ...todos.map((item) => ({
      kind: 'todo' as const,
      id: item.id,
      title: item.title,
      subtitle: `${item.courseName ?? '个人待办'} · ${todoStatusLabels[item.status]}${item.dueAt ? ` · ${item.dueAt}` : ''}`,
      target: { page: 'todo' as const, todoId: item.id },
    })),
    ...projects.map((row) => ({
      kind: 'project' as const,
      id: row.id,
      title: row.title,
      subtitle: null,
      target: { page: 'projects' as const, entryId: row.id },
    })),
    ...chats.map((row) => ({
      kind: 'chat' as const,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      target: { page: 'chat' as const, projectId: row.projectId, sessionId: row.id },
    })),
    ...mail.map((row) => ({
      kind: 'mail' as const,
      id: row.id,
      title: row.subject || '(无主题)',
      subtitle: row.senderName || row.senderAddress || row.snippet,
      target: { page: 'mail' as const, messageId: row.id },
    })),
    ...files.map((row) => ({
      kind: 'course-file' as const,
      id: row.id,
      title: row.title,
      subtitle: row.courseName,
      target: { page: 'sources' as const, sourceId: row.id },
    })),
  ];
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:query', (event, query: unknown) => {
    checkWorkspaceSender(event);
    return queryGlobalSearch(querySchema.parse(query));
  });
}
