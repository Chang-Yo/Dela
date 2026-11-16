import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { hostPorts } from '../../../core/ports';
import type { OfficeExportInfo } from '../../workspace/contract';

/** version 为导出时源文件的 mtime-size。 */
export interface OfficeExportLink {
  entryId: string;
  path: string;
  version: string;
  exportedAt: string;
}

const officeExportKey = (kind: string, id: string) => `preview-export:${kind}:${id}`;

export function readOfficeExportLink(kind: string, id: string): OfficeExportLink | null {
  try {
    const row = hostPorts()
      .database()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(officeExportKey(kind, id)) as { value: string } | undefined;
    const link = row ? (JSON.parse(row.value) as OfficeExportLink) : null;
    return link && typeof link.path === 'string' ? link : null;
  } catch {
    return null;
  }
}

export function writeOfficeExportLink(kind: string, id: string, link: OfficeExportLink): void {
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(officeExportKey(kind, id), JSON.stringify(link));
}

export function officeExportPreviewInfo(
  link: OfficeExportLink,
  version: string,
): OfficeExportInfo | null {
  try {
    // 条目被用户删除时（磁盘文件仍在）协议会 404，返回 null 让读取方回退到确认卡片。
    if (
      !hostPorts()
        .database()
        .prepare('SELECT 1 FROM workspace_entries WHERE id=?')
        .get(link.entryId)
    )
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
