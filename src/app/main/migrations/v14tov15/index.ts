import type Database from 'better-sqlite3';

const legacyKinds = '(file|assignment|discussion|page|module-item)';
// 目录节点 id 会内嵌资料 id（12:files/file:3、assignment:4:submission），一并改写。
const canvasId = (id: string) =>
  id.replace(new RegExp(`(^|/)${legacyKinds}:`, 'g'), '$1canvas-$2:');
const canvasIdOrNull = (id: string | null) => (id === null ? null : canvasId(id));

/**
 * Canvas 资料 id 统一加 canvas- 前缀，地址类型 canvas 并入通用的 source。
 * 改写资料缓存、项目快捷方式、通知跳转、标签页布局、PDF 导出关联与写信草稿的附件。
 */
export function v14tov15(db: Database.Database): void {
  db.exec(
    `UPDATE canvas_sources SET id = 'canvas-' || id, data = json_set(data, '$.id', 'canvas-' || id)`,
  );
  const updateItems = db.prepare('UPDATE canvas_courses SET items = ? WHERE id = ?');
  const courses = db.prepare('SELECT id, items FROM canvas_courses').all() as Array<{
    id: number;
    items: string;
  }>;
  for (const course of courses) {
    const items = JSON.parse(course.items) as Array<{
      id: string;
      parentId: string | null;
      sourceId: string | null;
    }>;
    const renamed = items.map((item) => ({
      ...item,
      id: canvasId(item.id),
      parentId: canvasIdOrNull(item.parentId),
      sourceId: canvasIdOrNull(item.sourceId),
    }));
    updateItems.run(JSON.stringify(renamed), course.id);
  }

  db.exec(`UPDATE workspace_entries SET source_id = 'canvas-' || source_id
    WHERE substr(source_id, 1, instr(source_id, ':')) IN ('file:', 'assignment:', 'discussion:', 'page:', 'module-item:')`);

  // 通知 id 以资料 id 结尾（canvas:<账号>:<资料 id>），不跟着改会把旧公告当成新公告再提醒一次。
  const updateNotice = db.prepare('UPDATE notifications SET id = ?, href = ? WHERE id = ?');
  const notices = db
    .prepare("SELECT id, href FROM notifications WHERE source = 'canvas'")
    .all() as Array<{ id: string; href: string }>;
  for (const notice of notices) {
    const href = JSON.parse(notice.href) as { sourceId?: string };
    if (href.sourceId === undefined) continue;
    const sourceId = canvasId(href.sourceId);
    const id = notice.id.endsWith(href.sourceId)
      ? notice.id.slice(0, -href.sourceId.length) + sourceId
      : notice.id;
    updateNotice.run(id, JSON.stringify({ ...href, sourceId }), notice.id);
  }

  db.exec(`UPDATE workspace_settings
    SET key = 'preview-export:source:canvas-' || substr(key, length('preview-export:canvas:') + 1)
    WHERE key LIKE 'preview-export:canvas:%'`);
  const updateSetting = db.prepare('UPDATE workspace_settings SET value = ? WHERE key = ?');
  const settings = db
    .prepare(
      "SELECT key, value FROM workspace_settings WHERE key LIKE 'email-draft:%' OR key LIKE 'layout:%'",
    )
    .all() as Array<{ key: string; value: string }>;
  for (const { key, value } of settings) {
    if (key.startsWith('layout:')) {
      const tabs = new RegExp(`source:${legacyKinds}:`, 'g');
      updateSetting.run(value.replace(tabs, 'source:canvas-$1:'), key);
      continue;
    }
    const draft = JSON.parse(value) as { attachments: Array<{ type: string; id?: string }> };
    const attachments = draft.attachments.map((address) =>
      address.type === 'canvas' ? { type: 'source', id: `canvas-${address.id}` } : address,
    );
    updateSetting.run(JSON.stringify({ ...draft, attachments }), key);
  }
}
