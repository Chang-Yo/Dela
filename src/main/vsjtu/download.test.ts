import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  choose: vi.fn(),
  download: vi.fn(),
  notify: vi.fn(),
  reveal: vi.fn(),
  enabled: true,
}));
let campus: EventEmitter;
vi.mock('electron', () => ({
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
  dialog: { showSaveDialog: boundary.choose },
  shell: { showItemInFolder: boundary.reveal },
}));
vi.mock('../ipc', () => ({ checkWorkspaceSender: () => {} }));
vi.mock('../settings/prefs', () => ({ savedExperimentalFeatures: () => boundary.enabled }));
vi.mock('../timetable/session', () => ({
  getCampusSession: async () => Object.assign(campus, { downloadURL: boundary.download }),
}));
vi.mock('./api', () => ({
  getStreams: async () => [
    { view: 5, duration: 3283, url: 'https://live.sjtu.edu.cn/test.mp4?key=private' },
  ],
}));
import { registerVsjtuIpc } from './ipc';
beforeEach(() => {
  campus = new EventEmitter();
  vi.clearAllMocks();
  boundary.enabled = true;
  registerVsjtuIpc();
});
const call = (name: string, ...args: unknown[]) =>
  boundary.handlers.get(`vsjtu:${name}`)!({ sender: {} }, ...args);

it('returns available views and duration without a playback route or signed media address', async () => {
  expect(await call('streams', 60)).toEqual([{ view: 5, duration: 3283 }]);
});

it('blocks new video operations while experimental features are disabled', async () => {
  boundary.enabled = false;
  await expect(call('streams', 60)).rejects.toThrow('试验功能');
  expect(() => call('download', 60, 5, '录像')).toThrow('试验功能');
  expect(boundary.choose).not.toHaveBeenCalled();
});

it('does not start a transfer when the native save dialog is cancelled', async () => {
  boundary.choose.mockResolvedValue({ canceled: true });
  await call('download', 60, 5, '录像');
  expect(boundary.download).not.toHaveBeenCalled();
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
