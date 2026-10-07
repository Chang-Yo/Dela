import { getDatabase } from '../database';

/** 项目档案（projects 表）：执行上下文字段，与 workspace_entries 的 kind='project' 条目 1:1。
 *  挂载点（名称、目录、树位置）仍在 workspace_entries，本表只存档案。 */

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
