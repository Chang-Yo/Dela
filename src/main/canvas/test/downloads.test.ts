import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasState, SourceItem } from '../../../shared/canvas';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(async () => '') },
  app: {},
}));
vi.mock('../api', () => ({
  getCanvasState: vi.fn(),
  syncCanvasCourse: vi.fn(),
  canvasExportFile: vi.fn(),
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
import { canvasExportFile, getCanvasState, syncCanvasCourse } from '../api';
import {
  canvasDownloadPlan,
  canvasDownloads,
  startCanvasDownload,
  stopCanvasDownload,
  retryCanvasDownload,
} from '../downloads';

const folder = (id: string, parentId: string | null, name = id): SourceItem => ({
  id,
  parentId,
  name,
  courseId: 1,
  kind: 'folder',
  sourceId: null,
});
const file = (id: string, parentId: string, sourceId: string, name: string): SourceItem => ({
  id,
  parentId,
  sourceId,
  name,
  courseId: 1,
  kind: 'file',
});
let directory: string;
let cached: string;
let state: CanvasState;
const finished = async (id: string) => {
  await vi.waitFor(() =>
    expect(['completed', 'cancelled', 'failed']).toContain(
      canvasDownloads().find((task) => task.id === id)!.state,
    ),
  );
  return canvasDownloads().find((task) => task.id === id)!;
};
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'dela-canvas-download-test-'));
  cached = join(directory, 'cache.txt');
  await writeFile(cached, 'new bytes');
  state = {
    connected: true,
    syncedAt: null,
    courses: [{ id: 1, name: '示例课', term: '2026 Fall', code: '', error: null, syncedAt: 'now' }],
    items: [
      folder('1:files', null, '文件'),
      folder('folder:2', '1:files', '课件'),
      file('a', 'folder:2', 'file:1', 'a.txt'),
      file('b', 'folder:2', 'file:2', 'b.txt'),
      folder('1:modules', null, '课程模块'),
      { ...folder('module:1', '1:modules', '第一周'), kind: 'module' },
      file('module-item:1', 'module:1', 'file:1', 'a.txt'),
    ],
  };
  vi.mocked(getCanvasState).mockReturnValue(state);
  vi.mocked(syncCanvasCourse).mockResolvedValue(state);
  vi.mocked(canvasExportFile).mockResolvedValue({ path: cached, mime: 'text/plain' });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('批量下载目录', () => {
  it('整门课程保留真实文件夹名称并去掉模块中的重复引用', () => {
    const plan = canvasDownloadPlan(state, { courseId: 1 });
    expect(plan.folder).toBe('示例课 [1]');
    expect(plan.files.map((item) => item.path)).toEqual(['文件/课件/a.txt', '文件/课件/b.txt']);
  });
  it('仅下载选中文件夹子树，保留课程内祖先层级与空文件夹', () => {
    state.items.push(folder('empty', 'module:1', '空目录'));
    const plan = canvasDownloadPlan(state, { courseId: 1, itemId: 'module:1' });
    expect(plan.files.map((item) => item.path)).toEqual(['课程模块/第一周/a.txt']);
    expect(plan.directories).toContain('课程模块/第一周/空目录');
  });
  it('清理不合法文件名，处理大小写、清理后重名和文件夹/文件同名', () => {
    state.items = [
      folder('1:files', null, '..'),
      folder('a', '1:files', 'X'),
      file('b', '1:files', 'file:1', 'x'),
      file('c', '1:files', 'file:2', 'a:b.txt'),
      file('d', '1:files', 'file:3', 'a?b.txt'),
      file('e', 'a', 'file:4', 'CON'),
    ];
    expect(canvasDownloadPlan(state, { courseId: 1 }).files.map((item) => item.path)).toEqual([
      'untitled/x (2)',
      'untitled/a_b.txt',
      'untitled/a_b (2).txt',
      'untitled/X/_CON',
    ]);
  });
  it('拒绝别的课程节点、文件节点及循环目录', () => {
    expect(() => canvasDownloadPlan(state, { courseId: 2 })).toThrow('课程不存在');
    expect(() => canvasDownloadPlan(state, { courseId: 1, itemId: 'a' })).toThrow('文件夹不存在');
    state.items[0]!.parentId = 'folder:2';
    expect(() => canvasDownloadPlan(state, { courseId: 1 })).toThrow('循环');
  });
});

it('覆盖成功文件；失败不破坏旧文件且不阻止其他文件；可仅重试失败项', async () => {
  const target = join(directory, '示例课 [1]', '文件', '课件');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'a.txt'), 'old a');
  await writeFile(join(target, 'b.txt'), 'old b');
  vi.mocked(canvasExportFile).mockRejectedValueOnce(new Error('权限不足'));
  const task = startCanvasDownload({ courseId: 1 }, directory);
  const result = await finished(task.id);
  expect(result.files.map((item) => item.state)).toEqual(['failed', 'completed']);
  expect(await readFile(join(target, 'a.txt'), 'utf8')).toBe('old a');
  expect(await readFile(join(target, 'b.txt'), 'utf8')).toBe('new bytes');
  expect(await readdir(target)).toEqual(['a.txt', 'b.txt']);
  vi.mocked(canvasExportFile).mockClear();
  retryCanvasDownload(task.id, 'file:1');
  expect((await finished(task.id)).files.every((item) => item.state === 'completed')).toBe(true);
  expect(canvasExportFile).toHaveBeenCalledExactlyOnceWith('file:1');
  expect(await readFile(join(target, 'a.txt'), 'utf8')).toBe('new bytes');
});

it('停止后等当前文件完成，余下文件不下载；后续任务可继续运行', async () => {
  let release!: () => void;
  vi.mocked(canvasExportFile).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { path: cached, mime: 'text/plain' };
  });
  const first = startCanvasDownload({ courseId: 1 }, directory);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const second = startCanvasDownload({ courseId: 1, itemId: 'module:1' }, directory);
  expect(canvasDownloads().find((task) => task.id === second.id)?.state).toBe('queued');
  stopCanvasDownload(first.id);
  release();
  expect((await finished(first.id)).files.map((item) => item.state)).toEqual([
    'completed',
    'cancelled',
  ]);
  expect((await finished(second.id)).files[0]!.state).toBe('completed');
  expect(canvasExportFile).toHaveBeenCalledTimes(2);
});

it('选择保存目录之后才读取远端目录；同步失败可重试，不显示成功', async () => {
  vi.mocked(syncCanvasCourse).mockRejectedValueOnce(new Error('离线'));
  expect(syncCanvasCourse).not.toHaveBeenCalled();
  const task = startCanvasDownload({ courseId: 1 }, directory);
  expect((await finished(task.id)).error).toBe('离线');
  expect(canvasExportFile).not.toHaveBeenCalled();
  retryCanvasDownload(task.id);
  expect((await finished(task.id)).files).toHaveLength(2);
});

it('部分目录同步失败时保留明确警告，不宣称备份完整', async () => {
  state.courses[0]!.error = '课程模块：Canvas HTTP 403';
  const task = startCanvasDownload({ courseId: 1 }, directory);
  expect((await finished(task.id)).warning).toContain('仅包含已列出的文件');
});

it('空文件夹可以保存；停止尚未开始的任务不会产生下载', async () => {
  let release!: () => void;
  vi.mocked(syncCanvasCourse).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return state;
  });
  const first = startCanvasDownload({ courseId: 1 }, directory);
  const second = startCanvasDownload({ courseId: 1 }, directory);
  stopCanvasDownload(second.id);
  stopCanvasDownload(first.id);
  release();
  await finished(first.id);
  expect((await finished(second.id)).state).toBe('cancelled');
  expect(canvasExportFile).not.toHaveBeenCalled();
  state.items = [folder('empty', null, '空目录')];
  const empty = startCanvasDownload({ courseId: 1, itemId: 'empty' }, directory);
  expect((await finished(empty.id)).files).toHaveLength(0);
  expect(await readdir(join(directory, '示例课 [1]', '空目录'))).toEqual([]);
});

it('复制失败不留下半文件，也不会覆盖已有文件', async () => {
  const target = join(directory, '示例课 [1]', '文件', '课件');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'a.txt'), 'keep');
  vi.mocked(canvasExportFile).mockResolvedValueOnce({ path: join(directory, 'missing'), mime: '' });
  const task = startCanvasDownload({ courseId: 1 }, directory);
  expect((await finished(task.id)).files[0]!.state).toBe('failed');
  expect(await readFile(join(target, 'a.txt'), 'utf8')).toBe('keep');
  expect((await readdir(target)).some((name) => name.endsWith('.part'))).toBe(false);
});

it.skipIf(process.platform === 'win32')('不沿目标文件夹中的符号链接写到其他目录', async () => {
  const root = join(directory, '示例课 [1]');
  const outside = join(directory, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await symlink(outside, join(root, '文件'));
  const task = startCanvasDownload({ courseId: 1 }, directory);
  expect((await finished(task.id)).files.every((item) => item.state === 'failed')).toBe(true);
  expect(await readdir(outside)).toEqual([]);
});
