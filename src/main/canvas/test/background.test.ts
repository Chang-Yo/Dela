import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasCourse, CanvasState } from '../../../shared/canvas';

const mocks = vi.hoisted(() => ({
  token: 'fixture-token' as string | null,
  credentialError: false,
  state: { connected: true, syncedAt: null, courses: [], items: [] } as CanvasState,
  list: vi.fn(),
  course: vi.fn(),
  windows: [] as {
    isDestroyed: () => boolean;
    webContents: { getURL: () => string; send: ReturnType<typeof vi.fn> };
  }[],
}));
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: { getAllWindows: () => mocks.windows },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../credentials', () => ({
  loadCanvasToken: () => {
    if (mocks.credentialError) throw new Error('credential unavailable');
    return mocks.token;
  },
}));
vi.mock('../../todo', () => ({}));
vi.mock('../../ipc', () => ({}));
vi.mock('../../database', () => ({}));
vi.mock('../api', () => ({
  getCanvasState: () => mocks.state,
  syncCanvasCourses: mocks.list,
  syncCanvasCourse: mocks.course,
}));

const course = (id: number, term: string, archived = false): CanvasCourse => ({
  id,
  term,
  archived,
  name: `Course ${id}`,
  code: '',
  syncedAt: null,
  error: null,
});

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.token = 'fixture-token';
  mocks.credentialError = false;
  mocks.state = {
    connected: true,
    syncedAt: null,
    items: [],
    courses: [
      course(1, '2026-2027 Fall'),
      course(2, '2026-2027 Fall'),
      course(3, '2026-2027 Fall', true),
      course(4, 'Michigan_2024-2025 Summer'),
    ],
  };
  mocks.list.mockImplementation(async () => mocks.state);
  mocks.course.mockImplementation(async () => mocks.state);
  mocks.windows = ['file:///app/out/renderer/index.html', 'https://oc.sjtu.edu.cn/login'].map(
    (url) => ({
      isDestroyed: () => false,
      webContents: { getURL: () => url, send: vi.fn() },
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('loads latest-term metadata at startup and every hour, including while no window is open', async () => {
  const { startCanvasSync } = await import('../ipc');
  mocks.windows = [];
  const stop = startCanvasSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.course.mock.calls).toEqual([[1], [2]]);
  await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(mocks.course.mock.calls).toEqual([[1], [2], [1], [2]]);
  stop();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('uses the refreshed course list to select a new term and broadcasts only to the workspace', async () => {
  const { refreshCanvas } = await import('../ipc');
  mocks.list.mockImplementation(async () => {
    mocks.state.courses.push(course(5, '2026-2027 Spring'));
    return mocks.state;
  });
  await refreshCanvas();
  expect(mocks.course.mock.calls).toEqual([[5]]);
  expect(mocks.windows[0]!.webContents.send).toHaveBeenCalledWith('canvas:changed', mocks.state);
  expect(mocks.windows[1]!.webContents.send).not.toHaveBeenCalled();
});

it('shares the running refresh with manual refresh and later timer ticks, and syncs courses sequentially', async () => {
  const { refreshCanvas, startCanvasSync } = await import('../ipc');
  let release!: () => void;
  mocks.course.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const stop = startCanvasSync();
  const manual = refreshCanvas();
  await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.course.mock.calls).toEqual([[1]]);
  release();
  await manual;
  expect(mocks.course.mock.calls).toEqual([[1], [2]]);
  stop();
});

it('skips courses archived while the refresh is running', async () => {
  const { refreshCanvas } = await import('../ipc');
  mocks.course.mockImplementationOnce(async () => {
    mocks.state.courses[1]!.archived = true;
    return mocks.state;
  });
  await refreshCanvas();
  expect(mocks.course.mock.calls).toEqual([[1]]);
});

it('does not request anything without a connection', async () => {
  const { refreshCanvas } = await import('../ipc');
  mocks.token = null;
  await refreshCanvas();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.course).not.toHaveBeenCalled();
});

it('stops the queue after disconnecting', async () => {
  const { refreshCanvas } = await import('../ipc');
  mocks.course.mockImplementationOnce(async () => {
    mocks.token = null;
    return mocks.state;
  });
  await refreshCanvas();
  expect(mocks.course.mock.calls).toEqual([[1]]);
});

it('retries a failed background refresh at the next hour and releases the in-flight lock', async () => {
  const { startCanvasSync } = await import('../ipc');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.list.mockRejectedValueOnce(new Error('offline'));
  const stop = startCanvasSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledTimes(1);
  expect(mocks.course).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(mocks.course.mock.calls).toEqual([[1], [2]]);
  stop();
});

it('does not prevent startup when credentials are temporarily unavailable', async () => {
  const { startCanvasSync } = await import('../ipc');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.credentialError = true;
  const stop = startCanvasSync();
  expect(mocks.list).not.toHaveBeenCalled();
  mocks.credentialError = false;
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(mocks.course.mock.calls).toEqual([[1], [2]]);
  stop();
});
