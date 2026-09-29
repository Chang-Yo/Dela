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
  /** 上下文压缩摘要 JSON（compaction 写入；NULL = 尚未压缩过）。 */
  summary: string | null;
  created_at: string;
  updated_at: string;
};

// 过渡期（阶段三移除）：旧 scope 语义的「当前打开会话」指针，仅供旧通道 shim 使用；
// 新 session:* API 不经过它。null 表示新对话闲置态；指针缺失视为新对话，不回退最近会话。
export const activeSession = new Map<string, string | null>();

/** 正在进行上下文压缩的会话（低干扰状态，随快照推送）。 */
export const compactingSessions = new Set<string>();

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
    compacting: row ? compactingSessions.has(row.id) : false,
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

/** 持久化上下文压缩摘要（压缩成功后调用；失败不写入，保留 NULL/旧摘要）。 */
export function saveSessionSummary(sessionId: string, summary: string): void {
  getDatabase().prepare('UPDATE sessions SET summary=? WHERE id=?').run(summary, sessionId);
}
