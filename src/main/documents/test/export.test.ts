import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../workspace/api', () => ({ createWorkspaceEntry: vi.fn() }));
vi.mock('../parse', () => ({ classifyOfficeFile: vi.fn(async () => 'pptx') }));
import { getDatabase } from '../../database';
import { createWorkspaceEntry } from '../../workspace/api';
import { registerResourceResolver } from '../../../core/capabilities/resources';
import { exportOfficePdf } from '../export';
import { readOfficeExportLink } from '../links';

const workspacePath = vi.fn<() => Promise<string>>();
registerResourceResolver('workspace', { read: vi.fn(), path: workspacePath });

let directory: string;
let source: string;
let db: Database.Database;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'dela-export-test-'));
  source = join(directory, '课件.pptx');
  writeFileSync(source, 'synthetic presentation');
  db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT)');
  db.exec(
    'CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, kind TEXT, source_id TEXT, local_path TEXT, updated_at TEXT)',
  );
  vi.mocked(getDatabase).mockReturnValue(db);
  workspacePath.mockResolvedValue(source);
  vi.mocked(createWorkspaceEntry).mockImplementation(() => {
    const path = join(directory, '预览导出');
    mkdirSync(path);
    db.prepare('INSERT INTO workspace_entries (id, kind, local_path) VALUES (?, ?, ?)').run(
      'exports',
      'folder',
      path,
    );
    return { id: 'exports' } as ReturnType<typeof createWorkspaceEntry>;
  });
  vi.mocked(spawn).mockImplementation((_command, _args, options) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => {
      writeFileSync(options!.env!.DELA_PPTX_OUTPUT!, '%PDF-1.4\nfixture');
      child.emit('close', 0);
    });
    return child as ReturnType<typeof spawn>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

it('Mac 拒绝转换，且不解析源文件或写入导出数据', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  const progress = vi.fn();
  await expect(exportOfficePdf({ type: 'workspace', id: source }, progress)).rejects.toThrow(
    '暂不支持',
  );
  expect(progress).not.toHaveBeenCalled();
  expect(workspacePath).not.toHaveBeenCalled();
  expect(getDatabase).not.toHaveBeenCalled();
  expect(createWorkspaceEntry).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it('Windows 保留 PowerPoint 调用、进度与 PDF 关联保存', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  const progress = vi.fn();
  await exportOfficePdf({ type: 'workspace', id: source }, progress);
  expect(spawn).toHaveBeenCalledWith(
    'powershell.exe',
    expect.arrayContaining(['-EncodedCommand']),
    expect.objectContaining({
      env: expect.objectContaining({ DELA_PPTX_INPUT: source }),
      windowsHide: true,
    }),
  );
  expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['preparing', 'converting']);
  const link = readOfficeExportLink('workspace', source);
  expect(link?.path).toBe(join(directory, '预览导出', '课件.pdf'));
  expect(readFileSync(link!.path, 'utf8')).toBe('%PDF-1.4\nfixture');
  expect(readFileSync(source, 'utf8')).toBe('synthetic presentation');
});
