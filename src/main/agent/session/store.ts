import { getDatabase } from '../../database';
import type { WorkspaceChat } from '../../../shared/api';
import { getActiveLlmProvider } from '../core/providers';
import { activeRuns } from './runs';

export type SessionRow = {
  id: string;
  /** 所属项目（projects.id）；NULL = 通用会话（旧 home/sources/projects 入口与孤儿会话）。 */
  project_id: string | null;
  title: string;
  messages: string;
  created_at: string;
  updated_at: string;
};

// 过渡期（阶段三移除）：旧 scope 语义的「当前打开会话」指针，仅供旧通道 shim 使用；
// 新 session:* API 不经过它。null 表示新对话闲置态；指针缺失视为新对话，不回退最近会话。
export const activeSession = new Map<string, string | null>();

export function sessionRow(id: string): SessionRow | null {
  return (
    (getDatabase().prepare('SELECT * FROM sessions WHERE id=?').get(id) as
      SessionRow | undefined) ?? null
  );
}

export function resolveSession(scope: string): SessionRow | null {
  const known = activeSession.get(scope);
  if (known === undefined) activeSession.set(scope, null);
  return known ? sessionRow(known) : null;
}

/** 会话快照：WorkspaceChat 形状不变（renderer 兼容）；running/activeTool 取自该 session 的活跃 Run。 */
export function snapshot(row: SessionRow | null): WorkspaceChat {
  const provider = getActiveLlmProvider();
  const effortLevels = provider?.effortLevels ?? [];
  const run = row ? activeRuns.get(row.id) : undefined;
  return {
    sessionId: row?.id ?? null,
    configured: Boolean(provider),
    providerName: provider?.name ?? null,
    model: provider?.model ?? '',
    models: provider?.models ?? [],
    effortLevels,
    effort: effortLevels.length ? (provider?.effort ?? effortLevels[0]!) : null,
    messages: row ? (JSON.parse(row.messages) as WorkspaceChat['messages']) : [],
    running: run !== undefined,
    activeTool: run?.tool,
  };
}

export function getChat(scope: string): WorkspaceChat {
  return snapshot(resolveSession(scope));
}

export function persistSession(row: SessionRow) {
  getDatabase()
    .prepare('UPDATE sessions SET messages=?, updated_at=? WHERE id=?')
    .run(row.messages, new Date().toISOString(), row.id);
}
