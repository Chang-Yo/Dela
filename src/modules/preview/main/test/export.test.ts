import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../../workspace', () => ({
  workspaceRootDirectory: vi.fn(),
  availablePath: (parent: string, name: string) => join(parent, name),
}));
vi.mock('../parse', () => ({ classifyOfficeFile: vi.fn(async () => 'pptx') }));
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { workspaceRootDirectory } from '../../../workspace';
import { registerResourceResolver } from '../../../../core/capabilities/resources';
import { exportOfficePdf } from '../export';
import { readOfficeExportLink } from '../links';

const workspacePath = vi.fn<() => Promise<string>>();
registerResourceResolver('workspace', {
  schema: z.object({ type: z.literal('workspace'), id: z.string() }),
  description: '',
  read: vi.fn(),
  path: workspacePath,
});

let directory: string;
let source: string;
let db: Database.Database;
const database = vi.fn(() => db);
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'dela-export-test-'));
  source = join(directory, '课件.pptx');
  writeFileSync(source, 'synthetic presentation');
  db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT)');
  provideTestHostPorts({ database });
  workspacePath.mockResolvedValue(source);
  vi.mocked(workspaceRootDirectory).mockReturnValue(directory);
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
  expect(workspacePath).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it('Windows 首次导出新建「预览导出」文件夹，并保存 PowerPoint 进度与 PDF 关联', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  const progress = vi.fn();
  await exportOfficePdf({ type: 'workspace', id: source }, progress);
  expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['preparing', 'converting']);
  const link = readOfficeExportLink('workspace', source);
  expect(link?.path).toBe(join(directory, '预览导出', '课件.pdf'));
  expect(readFileSync(link!.path, 'utf8')).toBe('%PDF-1.4\nfixture');
  expect(readFileSync(source, 'utf8')).toBe('synthetic presentation');
});
