import { app } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { getDatabase } from './database';
import type { OfficeExportInfo } from '../shared/api';

export function storageDirectory() {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='directory'")
    .get() as { value: string } | undefined;
  return row?.value ?? join(app.getPath('documents'), 'Dela');
}

// A single path component, including Windows device names and trailing dots/spaces.
export function diskName(name: string) {
  let value = name
    // oxlint-disable-next-line no-control-regex -- Windows filenames prohibit C0 control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!value) value = 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value;
}

export function availablePath(parent: string, name: string, folder = false) {
  const safe = diskName(name);
  const extension = folder ? '' : extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let path = join(parent, safe);
  for (let index = 2; existsSync(path); index += 1)
    path = join(parent, `${stem} (${index})${extension}`);
  return path;
}

/** pptx 导出 PDF 的关联记录；version 为导出时的源文件版本（Canvas updatedAt / 本地 mtime-size）。 */
export interface OfficeExportLink {
  entryId: string;
  path: string;
  version: string;
  exportedAt: string;
}

const officeExportKey = (kind: 'canvas' | 'workspace', id: string) =>
  `preview-export:${kind}:${id}`;

/** 读取关联；键不存在或存储损坏时返回 null，文件是否仍存在由调用方判断。 */
export function readOfficeExportLink(
  kind: 'canvas' | 'workspace',
  id: string,
): OfficeExportLink | null {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(officeExportKey(kind, id)) as { value: string } | undefined;
    const link = row ? (JSON.parse(row.value) as OfficeExportLink) : null;
    return link && typeof link.path === 'string' ? link : null;
  } catch {
    return null;
  }
}

export function writeOfficeExportLink(
  kind: 'canvas' | 'workspace',
  id: string,
  link: OfficeExportLink,
): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(officeExportKey(kind, id), JSON.stringify(link));
}

/** 由关联记录构造 renderer 直接渲染 PDF 所需的信息；导出文件或其条目已不存在时返回 null。 */
export function officeExportPreviewInfo(
  link: OfficeExportLink,
  version: string,
): OfficeExportInfo | null {
  try {
    // 条目可能已被用户删除（仓库约定删除条目不删磁盘文件）：此时协议按条目 id 解析会 404，
    // 返回 null 让读取方回退到导出确认卡片。
    if (!getDatabase().prepare('SELECT 1 FROM workspace_entries WHERE id=?').get(link.entryId))
      return null;
    const stats = statSync(link.path);
    return {
      previewUrl: `dela-resource://workspace/${encodeURIComponent(link.entryId)}?v=${stats.mtimeMs}-${stats.size}`,
      title: basename(link.path),
      stale: link.version !== version,
    };
  } catch {
    return null;
  }
}
