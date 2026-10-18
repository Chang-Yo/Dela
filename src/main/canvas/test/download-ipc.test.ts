import { beforeEach, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  app: {},
  dialog: { showOpenDialog: vi.fn() },
  shell: {},
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
  },
}));
vi.mock('../../todo', () => ({ broadcastTodos: vi.fn(), refreshTodos: vi.fn() }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../credentials', () => ({ clearCanvasToken: vi.fn() }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../api', () =>
  Object.fromEntries(
    [
      'getCanvasState',
      'configureCanvas',
      'syncCanvasCourses',
      'syncCanvasCourse',
      'getSource',
      'cachedFile',
      'cachedCourseFiles',
      'readCanvasSource',
      'archiveCanvasCourse',
    ].map((name) => [name, vi.fn()]),
  ),
);
vi.mock('../downloads', () =>
  Object.fromEntries(
    [
      'canvasDownloadPlan',
      'canvasDownloads',
      'revealCanvasDownload',
      'retryCanvasDownload',
      'startCanvasDownload',
      'stopCanvasDownload',
    ].map((name) => [name, vi.fn()]),
  ),
);
import { dialog } from 'electron';
import { getCanvasState } from '../api';
import { checkWorkspaceSender } from '../../ipc';
import { startCanvasDownload } from '../downloads';
import { registerCanvasIpc } from '../ipc';

beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
  vi.mocked(getCanvasState).mockReturnValue({
    connected: true,
    syncedAt: null,
    courses: [],
    items: [],
  });
  registerCanvasIpc();
});
const start = (input: unknown) => handlers.get('canvas:start-download')!({}, input);

it('取消目录选择不创建任务、不启动下载', async () => {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await start({ courseId: 1 })).toBeNull();
  expect(startCanvasDownload).not.toHaveBeenCalled();
  expect(checkWorkspaceSender).toHaveBeenCalled();
});
it('只能使用主进程原生选择器返回的目录，并明确提示覆盖同名文件', async () => {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/chosen'] });
  await start({ courseId: 1, itemId: 'folder:2' });
  expect(startCanvasDownload).toHaveBeenCalledWith({ courseId: 1, itemId: 'folder:2' }, '/chosen');
  expect(dialog.showOpenDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      title: expect.stringContaining('覆盖同名文件'),
      properties: ['openDirectory', 'createDirectory'],
    }),
  );
  await expect(start({ courseId: 1, directory: '/injected' })).rejects.toThrow();
  expect(startCanvasDownload).toHaveBeenCalledTimes(1);
});
it('未连接或非工作区调用不打开选择器', async () => {
  vi.mocked(getCanvasState).mockReturnValue({
    connected: false,
    syncedAt: null,
    courses: [],
    items: [],
  });
  await expect(start({ courseId: 1 })).rejects.toThrow('先连接');
  vi.mocked(checkWorkspaceSender).mockImplementation(() => {
    throw new Error('不允许的调用来源');
  });
  expect(() => start({ courseId: 1 })).toThrow('不允许');
  expect(dialog.showOpenDialog).not.toHaveBeenCalled();
});
