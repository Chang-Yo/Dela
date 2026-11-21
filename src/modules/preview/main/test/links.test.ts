import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import {
  officeExportPreviewInfo,
  readOfficeExportLink,
  writeOfficeExportLink,
  type OfficeExportLink,
} from '../links';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => tmpdir()) } }));

const db = new Database(':memory:');
db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT)');

const link: OfficeExportLink = {
  path: 'Dela/workspace/预览导出/A.pdf',
  version: 'v1',
  exportedAt: '2026-09-28T00:00:00.000Z',
};

beforeEach(() => {
  db.exec('DELETE FROM workspace_settings');
  provideTestHostPorts({ database: () => db });
});

describe('office export links', () => {
  it('round-trips links per source kind and id', () => {
    expect(readOfficeExportLink('source', 'canvas-file:1')).toBeNull();
    writeOfficeExportLink('source', 'canvas-file:1', link);
    expect(readOfficeExportLink('source', 'canvas-file:1')).toEqual(link);
    // 键按来源隔离：workspace 同名 id 不受影响。
    expect(readOfficeExportLink('workspace', 'canvas-file:1')).toBeNull();
    writeOfficeExportLink('workspace', 'canvas-file:1', { ...link, version: 'v2' });
    expect(readOfficeExportLink('source', 'canvas-file:1')?.version).toBe('v1');
    expect(readOfficeExportLink('workspace', 'canvas-file:1')?.version).toBe('v2');
  });

  it('treats corrupt stored values as absent', () => {
    db.prepare(
      "INSERT INTO workspace_settings VALUES ('preview-export:source:canvas-file:2', '{oops')",
    ).run();
    expect(readOfficeExportLink('source', 'canvas-file:2')).toBeNull();
  });

  it('builds preview info with stale flag from source version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dela-link-'));
    try {
      const path = join(dir, 'A.pdf');
      await writeFile(path, '%PDF-1.4');
      const stored = { ...link, path };
      const fresh = officeExportPreviewInfo(stored, 'v1');
      expect(fresh).not.toBeNull();
      expect(fresh!.stale).toBe(false);
      expect(officeExportPreviewInfo(stored, 'v2')!.stale).toBe(true);
      expect(
        officeExportPreviewInfo({ ...stored, path: join(dir, 'missing.pdf') }, 'v1'),
      ).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
