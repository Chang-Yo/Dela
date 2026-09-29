import { getDatabase } from '../../database';
import type { ChatSessionSummary, WorkspaceChat } from '../../../shared/api';
import { getActiveLlmProvider } from '../core/providers';
import { asking } from './runs';

export type SessionRow = {
  id: string;
  scope: string;
  title: string;
  messages: string;
  created_at: string;
  updated_at: string;
};

// 每个 scope 记住当前打开的会话；null 表示新对话闲置态（点了“新对话”，或重启后尚未恢复历史）。
// 指针缺失（进程启动后首次访问）同样视为新对话，不回退最近会话；历史经 listChats/openChat 找回。
export const activeSession = new Map<string, string | null>();

export function sessionRow(id: string): SessionRow | null {
  return (
    (getDatabase().prepare('SELECT * FROM chat_sessions WHERE id=?').get(id) as
      SessionRow | undefined) ?? null
  );
}

export function resolveSession(scope: string): SessionRow | null {
  const known = activeSession.get(scope);
  if (known === undefined) activeSession.set(scope, null);
  return known ? sessionRow(known) : null;
}

export function snapshot(row: SessionRow | null): WorkspaceChat {
  const provider = getActiveLlmProvider();
  const effortLevels = provider?.effortLevels ?? [];
  return {
    sessionId: row?.id ?? null,
    configured: Boolean(provider),
    providerName: provider?.name ?? null,
    model: provider?.model ?? '',
    models: provider?.models ?? [],
    effortLevels,
    effort: effortLevels.length ? (provider?.effort ?? effortLevels[0]!) : null,
    messages: row ? (JSON.parse(row.messages) as WorkspaceChat['messages']) : [],
    running: asking.has(row?.scope ?? ''),
    activeTool: asking.get(row?.scope ?? '')?.tool,
  };
}

export function getChat(scope: string): WorkspaceChat {
  return snapshot(resolveSession(scope));
}

export function listChats(scope: string, query: string): ChatSessionSummary[] {
  const rows = (query
    ? getDatabase()
        .prepare(
          // 转义 LIKE 通配符，按标题或消息原文匹配。
          "SELECT id, title, updated_at AS updatedAt, json_array_length(messages) AS messageCount FROM chat_sessions WHERE scope=? AND (title LIKE ? ESCAPE '\\' OR messages LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 100",
        )
        .all(
          scope,
          `%${query.replace(/[\\%_]/g, '\\$&')}%`,
          `%${query.replace(/[\\%_]/g, '\\$&')}%`,
        )
    : getDatabase()
        .prepare(
          'SELECT id, title, updated_at AS updatedAt, json_array_length(messages) AS messageCount FROM chat_sessions WHERE scope=? ORDER BY updated_at DESC LIMIT 100',
        )
        .all(scope)) as unknown as ChatSessionSummary[];
  return rows;
}

export function persistSession(row: SessionRow) {
  getDatabase()
    .prepare('UPDATE chat_sessions SET messages=?, updated_at=? WHERE id=?')
    .run(row.messages, new Date().toISOString(), row.id);
}
