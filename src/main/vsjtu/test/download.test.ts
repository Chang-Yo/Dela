import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  choose: vi.fn(),
  download: vi.fn(),
  notify: vi.fn(),
  reveal: vi.fn(),
  enabled: true,
  classroom: true,
  directory: '',
}));
let campus: EventEmitter;
vi.mock('electron', () => ({
  app: { getPath: () => 'C:/Videos' },
  ipcMain: {
    handle: (name: string, callback: (...args: unknown[]) => unknown) =>
      boundary.handlers.set(name, callback),
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getAllWindows: () => [
      { webContents: { getURL: () => 'file:///app/index.html', send: boundary.notify } },
    ],
  },
  dialog: { showSaveDialog: boundary.choose, showOpenDialog: boundary.choose },
  shell: { showItemInFolder: boundary.reveal },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: () => {} }));
vi.mock('../../settings/prefs', () => ({
  savedExperimentalFeatures: () => boundary.enabled,
  savedExperimentalClassroom: () => boundary.classroom,
  savedVideoDownloadDirectory: () => boundary.directory,
  setVideoDownloadDirectory: (value: string) => (boundary.directory = value),
}));
vi.mock('../../campus', () => ({
  getCampusSession: async () => Object.assign(campus, { downloadURL: boundary.download }),
}));
vi.mock('../api', () => ({
  getStreams: async () => [
    { view: 5, duration: 3283, url: 'https://live.sjtu.edu.cn/test.mp4?key=private' },
  ],
}));
import { registerVsjtuIpc } from '../ipc';
beforeEach(() => {
  campus = new EventEmitter();
  vi.clearAllMocks();
  boundary.enabled = true;
  boundary.classroom = true;
  boundary.directory = '';
  registerVsjtuIpc();
});
const call = (name: string, ...args: unknown[]) =>
  boundary.handlers.get(`vsjtu:${name}`)!({ sender: {} }, ...args);

it('returns available views and duration with an opaque playback route, never the signed media address', async () => {
  const streams = (await call('streams', 60)) as Array<{
    view: number;
    duration: number;
    playbackUrl: string;
  }>;
  expect(streams).toHaveLength(1);
  const [stream] = streams;
  expect(stream?.view).toBe(5);
  expect(stream?.duration).toBe(3283);
  expect(stream?.playbackUrl).toMatch(/^dela-resource:\/\/vsjtu\/video\/60\/5\?t=[0-9a-f]{32}$/);
});

it('blocks new video operations while experimental features are disabled', async () => {
  boundary.enabled = false;
  await expect(call('streams', 60)).rejects.toThrow('试验功能');
  expect(() => call('download', 60, 5, '录像')).toThrow('试验功能');
  expect(() => call('get-download-directory')).toThrow('试验功能');
  expect(boundary.choose).not.toHaveBeenCalled();
});

it('blocks new video operations when the classroom sub-item is off even with the master on', async () => {
  boundary.classroom = false;
  await expect(call('streams', 60)).rejects.toThrow('试验功能');
});

it('does not start a transfer when the native save dialog is cancelled', async () => {
  boundary.choose.mockResolvedValue({ canceled: true });
  await call('download', 60, 5, '录像');
  expect(boundary.download).not.toHaveBeenCalled();
});

it('starts the save dialog in the configured video directory, or by file name alone when unset', async () => {
  boundary.choose.mockResolvedValue({ canceled: true });
  await call('download', 60, 5, '线性代数 第3讲');
  expect(boundary.choose.mock.calls[0]?.[0]).toMatchObject({
    defaultPath: '线性代数 第3讲-画面5.mp4',
  });
  boundary.directory = 'D:/课堂录像';
  await call('download', 61, 5, '线性代数 第3讲');
  expect(boundary.choose.mock.calls[1]?.[0]).toMatchObject({
    defaultPath: join('D:/课堂录像', '线性代数 第3讲-画面5.mp4'),
  });
});

it('round-trips the download directory through the picker and keeps the old value on cancel', async () => {
  expect(await call('get-download-directory')).toBe('');
  boundary.choose.mockResolvedValue({ canceled: false, filePaths: ['D:/课堂录像'] });
  expect(await call('choose-download-directory')).toBe('D:/课堂录像');
  expect(await call('get-download-directory')).toBe('D:/课堂录像');
  boundary.choose.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await call('choose-download-directory')).toBe('D:/课堂录像');
});

it('reports network interruption distinctly from a user cancellation and never reveals an incomplete file', async () => {
  boundary.choose.mockResolvedValue({ canceled: false, filePath: 'C:/Downloads/video.mp4' });
  const item = Object.assign(new EventEmitter(), {
    getURL: () => 'https://live.sjtu.edu.cn/test.mp4?key=private',
    getTotalBytes: () => 100,
    getReceivedBytes: () => 40,
    setSavePath: vi.fn(),
    cancel: () => item.emit('done', {}, 'cancelled'),
  });
  boundary.download.mockImplementation(() =>
    queueMicrotask(() => campus.emit('will-download', {}, item)),
  );
  await call('download', 61, 5, '录像');
  await expect(call('download', 61, 5, '录像')).rejects.toThrow('正在下载');
  item.emit('updated', {}, 'interrupted');
  const state = (await call('downloads')) as Array<{ id: string; state: string; received: number }>;
  expect(state.find((entry) => entry.id === '61/5')).toMatchObject({
    state: 'interrupted',
    received: 40,
  });
  await call('reveal-download', '61/5');
  expect(boundary.reveal).not.toHaveBeenCalled();
});
