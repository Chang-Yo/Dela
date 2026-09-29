import { getDatabase } from '../database';

/** 项目档案（projects 表）：执行上下文字段，与 workspace_entries 的 kind='project' 条目 1:1。
 *  挂载点（名称、目录、树位置）仍在 workspace_entries，本表只存档案（state-model.md §2.1）。 */
export interface ProjectProfile {
  id: string;
  background: string;
  goal: string;
  workdir: string | null;
  /** 项目级能力覆盖（JSON）；MCP/Skills 落地（阶段四）前恒为 '{}'，本轮只读。 */
  capabilities: unknown;
}

type ProfileRow = {
  background: string;
  goal: string;
  workdir: string | null;
  capabilities: string;
};

/** 档案行懒补建：v13 之后新建或由 folder 原地转换的项目条目在首次访问时建档。 */
export function ensureProjectProfile(id: string): void {
  getDatabase()
    .prepare('INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES (?, ?, ?)')
    .run(id, new Date().toISOString(), new Date().toISOString());
}

/** 删除档案行（project→folder 降格）：sessions/runs 的 project_id 经 FK 置 NULL，会话降级通用。 */
export function deleteProjectProfile(id: string): void {
  getDatabase().prepare('DELETE FROM projects WHERE id=?').run(id);
}

/** 读取项目档案；条目不存在或不是 project 时返回 null。 */
export function getProjectProfile(id: string): ProjectProfile | null {
  const entry = getDatabase().prepare('SELECT kind FROM workspace_entries WHERE id=?').get(id) as
    { kind: string } | undefined;
  if (!entry || entry.kind !== 'project') return null;
  ensureProjectProfile(id);
  const row = getDatabase()
    .prepare('SELECT background, goal, workdir, capabilities FROM projects WHERE id=?')
    .get(id) as ProfileRow | undefined;
  if (!row) return null;
  let capabilities: unknown = {};
  try {
    capabilities = JSON.parse(row.capabilities);
  } catch {
    // 损坏的 capabilities JSON 不阻塞档案读取。
  }
  return { id, background: row.background, goal: row.goal, workdir: row.workdir, capabilities };
}

/** 更新档案（background/goal/workdir；capabilities 本轮不可写）；条目无效时返回 null。 */
export function updateProjectProfile(
  id: string,
  input: { background?: string; goal?: string; workdir?: string | null },
): ProjectProfile | null {
  const current = getProjectProfile(id);
  if (!current) return null;
  const next = {
    background: input.background ?? current.background,
    goal: input.goal ?? current.goal,
    // workdir 传 null 清空、不传保留。
    workdir: input.workdir !== undefined ? input.workdir : current.workdir,
  };
  getDatabase()
    .prepare('UPDATE projects SET background=?, goal=?, workdir=?, updated_at=? WHERE id=?')
    .run(next.background, next.goal, next.workdir, new Date().toISOString(), id);
  return { ...current, ...next };
}
