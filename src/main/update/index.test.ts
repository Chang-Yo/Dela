import { beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../shared/update';
import type { NativeCheckResult, NativeOperationResult } from './native';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => Promise<UpdateSnapshot>>(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  setPendingInstall: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        getNativeWindowHandle: () => Buffer.alloc(8),
        webContents: { send: vi.fn() },
      },
    ],
  },
  ipcMain: {
    handle: (name: string, handler: () => Promise<UpdateSnapshot>) =>
      mocks.handlers.set(name, handler),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../settings/prefs', () => ({
  savedPendingInstall: () => false,
  setPendingInstall: mocks.setPendingInstall,
}));
vi.mock('./native', () => ({ loadStoreUpdate: () => mocks }));

function invoke(action: string) {
  return mocks.handlers.get(`update:${action}`)!();
}

function pending<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('process', { ...process, windowsStore: true });
  mocks.handlers.clear();
  mocks.check.mockResolvedValue({
    ok: true,
    updates: [{ version: '1.0.1.0', mandatory: false, familyName: 'MADFilm.Dela_abc' }],
  });
  mocks.download.mockResolvedValue({ ok: true });
  mocks.install.mockResolvedValue({ ok: true });
  const { registerUpdateIpc } = await import('./index');
  registerUpdateIpc();
  await invoke('get-state');
  vi.unstubAllGlobals();
});

it.each(['check', 'download', 'install'])(
  '%s 进行中重复请求不调用原生模块，也不覆盖原结果',
  async (action) => {
    if (action !== 'check') await invoke('check');
    if (action === 'install') await invoke('download');
    const operation = pending<NativeCheckResult | NativeOperationResult>();
    const method = mocks[action as 'check' | 'download' | 'install'];
    method.mockReturnValueOnce(operation.promise);
    const first = invoke(action);
    const duplicate = await invoke(action);
    expect(duplicate.phase).toBe(
      { check: 'checking', download: 'downloading', install: 'installing' }[action],
    );
    expect(method).toHaveBeenCalledTimes(1);
    operation.resolve(action === 'check' ? { ok: true, updates: [] } : { ok: true });
    expect((await first).phase).toBe(
      { check: 'up-to-date', download: 'ready', install: 'installed' }[action],
    );
  },
);

it.each(['download', 'install'])('%s 失败后直接重试能完成', async (action) => {
  await invoke('check');
  if (action === 'install') await invoke('download');
  const method = mocks[action as 'download' | 'install'];
  method.mockResolvedValueOnce({ ok: false, code: 0, state: 'Canceled', message: 'cancelled' });
  const failed = await invoke(action);
  expect(failed.phase).toBe('error');
  expect(failed.failedAt).toBe(action);
  const wrongAction = action === 'download' ? 'install' : 'download';
  expect(await invoke(wrongAction)).toEqual(failed);
  expect((await invoke(action)).phase).toBe(action === 'download' ? 'ready' : 'installed');
  expect(method).toHaveBeenCalledTimes(2);
});

it('推迟只在下载完成后落盘，手动安装前清除标记', async () => {
  await invoke('defer-install');
  expect(mocks.setPendingInstall).not.toHaveBeenCalled();
  await invoke('check');
  await invoke('download');
  await invoke('defer-install');
  expect(mocks.setPendingInstall).toHaveBeenCalledWith(true);
  await invoke('install');
  expect(mocks.setPendingInstall).toHaveBeenLastCalledWith(false);
});

it('清除待装标记失败时不安装，状态可重试', async () => {
  await invoke('check');
  await invoke('download');
  mocks.setPendingInstall.mockImplementationOnce(() => {
    throw new Error('database failure');
  });
  expect((await invoke('install')).phase).toBe('error');
  expect(mocks.install).not.toHaveBeenCalled();
});
