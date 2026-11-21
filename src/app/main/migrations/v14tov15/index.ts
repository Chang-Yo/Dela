import type Database from 'better-sqlite3';

/** Canvas 资料的地址 canvas 并入通用的 source：改写 PDF 导出关联的键与 Agent 写信草稿里的附件。 */
export function v14tov15(db: Database.Database): void {
  db.exec(`UPDATE workspace_settings
    SET key = 'preview-export:source:' || substr(key, length('preview-export:canvas:') + 1)
    WHERE key LIKE 'preview-export:canvas:%'`);
  db.exec(`UPDATE workspace_settings
    SET value = replace(value, '"type":"canvas"', '"type":"source"')
    WHERE key LIKE 'email-draft:%'`);
}
