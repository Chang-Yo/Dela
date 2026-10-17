import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../canvas/api', () => ({ canvasFilePath: vi.fn(), getSource: vi.fn() }));
vi.mock('../../workspace/api', () => ({
  createWorkspaceEntry: vi.fn(),
  workspaceFilePath: vi.fn(),
}));
vi.mock('../parse', () => ({ classifyOfficeFile: vi.fn(async () => 'pptx') }));
import { getDatabase } from '../../database';
import { canvasFilePath, getSource } from '../../canvas/api';
import { createWorkspaceEntry, workspaceFilePath } from '../../workspace/api';
import { exportOfficePdf } from '../export';
import { readOfficeExportLink } from '../links';

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
  vi.mocked(workspaceFilePath).mockResolvedValue(source);
  vi.mocked(canvasFilePath).mockResolvedValue(source);
  vi.mocked(getSource).mockReturnValue({ title: '课件.pptx', updatedAt: 'v1' } as ReturnType<
    typeof getSource
  >);
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

it.each(['workspace', 'canvas'] as const)(
  'Mac 拒绝 %s 转换，且不下载或写入导出数据',
  async (type) => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const progress = vi.fn();
    await expect(exportOfficePdf({ type, id: source }, progress)).rejects.toThrow('暂不支持');
    expect(progress).not.toHaveBeenCalled();
    expect(workspaceFilePath).not.toHaveBeenCalled();
    expect(canvasFilePath).not.toHaveBeenCalled();
    expect(getSource).not.toHaveBeenCalled();
    expect(getDatabase).not.toHaveBeenCalled();
    expect(createWorkspaceEntry).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  },
);

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
