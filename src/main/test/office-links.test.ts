import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../database';
import {
  officeExportPreviewInfo,
  readOfficeExportLink,
  writeOfficeExportLink,
  type OfficeExportLink,
} from '../storage';

vi.mock('../database', () => ({ getDatabase: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => tmpdir()) } }));

const db = new Database(':memory:');
db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT)');
db.exec(
  'CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, kind TEXT, source_id TEXT, note_id TEXT, local_path TEXT, remote_id TEXT, updated_at TEXT)',
);

const link: OfficeExportLink = {
  entryId: '00000000-0000-4000-8000-000000000002',
  path: 'Dela/workspace/预览导出/A.pdf',
  version: 'v1',
  exportedAt: '2026-09-28T00:00:00.000Z',
};

beforeEach(() => {
  db.exec('DELETE FROM workspace_settings');
  db.exec('DELETE FROM workspace_entries');
  db.prepare('INSERT INTO workspace_entries (id, kind) VALUES (?, ?)').run(
    link.entryId,
    'imported',
  );
  vi.mocked(getDatabase).mockReturnValue(db);
});

describe('office export links', () => {
  it('round-trips links per source kind and id', () => {
    expect(readOfficeExportLink('canvas', 'file:1')).toBeNull();
    writeOfficeExportLink('canvas', 'file:1', link);
    expect(readOfficeExportLink('canvas', 'file:1')).toEqual(link);
    // 键按来源隔离：workspace 同名 id 不受影响。
    expect(readOfficeExportLink('workspace', 'file:1')).toBeNull();
    writeOfficeExportLink('workspace', 'file:1', { ...link, version: 'v2' });
    expect(readOfficeExportLink('canvas', 'file:1')?.version).toBe('v1');
    expect(readOfficeExportLink('workspace', 'file:1')?.version).toBe('v2');
  });

  it('treats corrupt stored values as absent', () => {
    db.prepare(
      "INSERT INTO workspace_settings VALUES ('preview-export:canvas:file:2', '{oops')",
    ).run();
    expect(readOfficeExportLink('canvas', 'file:2')).toBeNull();
  });

  it('builds preview info with stale flag from source version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dela-link-'));
    try {
      const path = join(dir, 'A.pdf');
      await writeFile(path, '%PDF-1.4');
      const stored = { ...link, path };
      const fresh = officeExportPreviewInfo(stored, 'v1');
      expect(fresh).not.toBeNull();
      expect(fresh!.title).toBe('A.pdf');
      expect(fresh!.stale).toBe(false);
      expect(
        fresh!.previewUrl.startsWith(
          `dela-resource://workspace/${encodeURIComponent(link.entryId)}?v=`,
        ),
      ).toBe(true);
      expect(officeExportPreviewInfo(stored, 'v2')!.stale).toBe(true);
      expect(
        officeExportPreviewInfo({ ...stored, path: join(dir, 'missing.pdf') }, 'v1'),
      ).toBeNull();
      // 条目被删除（仓库约定删除条目不删磁盘文件）后回退 null，让读取方显示导出卡片。
      db.prepare('DELETE FROM workspace_entries WHERE id=?').run(link.entryId);
      expect(officeExportPreviewInfo(stored, 'v1')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
