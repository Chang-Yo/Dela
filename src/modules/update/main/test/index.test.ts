import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../contract';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  setPendingInstall: vi.fn(),
  isPackaged: true,
  openExternal: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getVersion: () => '1.0.0',
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: {
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: mocks.downloadUpdate,
    quitAndInstall: mocks.quitAndInstall,
    on: (name: string, listener: (value: unknown) => void) => mocks.listeners.set(name, listener),
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    set channel(_value: string) {
      this.allowDowngrade = true;
    },
  },
}));
vi.mock('../../../../core/ports', () => ({ emit: vi.fn() }));
vi.mock('../../../settings', () => ({
  savedPendingInstall: () => false,
  setPendingInstall: mocks.setPendingInstall,
}));

let invoke: (action: string) => Promise<UpdateSnapshot>;
function pending() {
  let resolve!: (result: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  mocks.isPackaged = true;
  mocks.listeners.clear();
  mocks.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: '1.0.1' },
  });
  mocks.downloadUpdate.mockResolvedValue(['installer.exe']);
  const { updateModule } = await import('../../index');
  invoke = async (action) => (await updateModule.ipc!.call(action, undefined)) as UpdateSnapshot;
});

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
  'Linux packaged=%s 从初始状态即禁用更新且所有入口不联网或安装',
  async (packaged) => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    mocks.isPackaged = packaged;
    for (const action of ['state', 'check', 'download', 'install']) {
      expect(await invoke(action)).toMatchObject({
        phase: 'unsupported',
        reason: 'platform-unsupported',
        version: null,
      });
    }
    await invoke('deferInstall');
    await invoke('openDownloadPage');
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.setPendingInstall).not.toHaveBeenCalled();
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  },
);

it('只检查正式版，关闭自动下载、退出安装和降级', async () => {
  const state = await invoke('check');
  expect(state.phase).toBe('available');
  expect(state.version).toBe('1.0.1');
  const { autoUpdater } = await import('electron-updater');
  expect(autoUpdater.autoDownload).toBe(false);
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  expect(autoUpdater.autoRunAppAfterInstall).toBe(true);
  expect(autoUpdater.allowPrerelease).toBe(false);
  expect(autoUpdater.allowDowngrade).toBe(false);
  expect(mocks.downloadUpdate).not.toHaveBeenCalled();
  expect(mocks.quitAndInstall).not.toHaveBeenCalled();
});

it.each(['check', 'download'])('%s 进行中重复请求不重入', async (action) => {
  if (action === 'download') await invoke('check');
  const operation = pending();
  const method = action === 'check' ? mocks.checkForUpdates : mocks.downloadUpdate;
  method.mockReturnValueOnce(operation.promise);
  const first = invoke(action);
  expect((await invoke(action)).phase).toBe(action === 'check' ? 'checking' : 'downloading');
  expect(method).toHaveBeenCalledTimes(1);
  operation.resolve(
    action === 'check'
      ? { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }
      : ['installer.exe'],
  );
  expect((await first).phase).toBe(action === 'check' ? 'up-to-date' : 'ready');
});

it('更新文件校验失败不会进入待安装，允许重新下载', async () => {
  await invoke('check');
  mocks.downloadUpdate.mockRejectedValueOnce(
    Object.assign(new Error('checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }),
  );
  const failed = await invoke('download');
  expect(failed).toMatchObject({ phase: 'error', failedAt: 'download', reason: 'invalid-update' });
  expect(await invoke('install')).toEqual(failed);
  expect((await invoke('download')).phase).toBe('ready');
  expect(mocks.quitAndInstall).not.toHaveBeenCalled();
});

it('100% 不直接允许安装，正式完成事件在 Promise 收尾前就能进入 ready', async () => {
  await invoke('check');
  const operation = pending();
  mocks.downloadUpdate.mockReturnValueOnce(operation.promise);
  const downloading = invoke('download');
  mocks.listeners.get('download-progress')!({ percent: 100, transferred: 100, total: 100 });
  expect((await invoke('state')).phase).toBe('downloading');
  mocks.listeners.get('update-downloaded')!({ version: '0.9.0' });
  expect((await invoke('state')).phase).toBe('downloading');
  mocks.listeners.get('update-downloaded')!({ version: '1.0.1' });
  expect((await invoke('state')).phase).toBe('ready');
  operation.resolve(['installer.exe']);
  expect((await downloading).phase).toBe('ready');
});

it('缺少 latest.yml 是检查失败，不能报已是最新，且可重试', async () => {
  mocks.checkForUpdates.mockRejectedValueOnce(
    Object.assign(new Error('404'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }),
  );
  expect(await invoke('check')).toMatchObject({
    phase: 'error',
    reason: 'feed-unavailable',
    failedAt: 'check',
  });
  expect((await invoke('check')).phase).toBe('available');
});

it('推迟只在 ready 落盘，安装先清标记且只启动一次，不提前宣称成功', async () => {
  await invoke('deferInstall');
  expect(mocks.setPendingInstall).not.toHaveBeenCalled();
  await invoke('check');
  await invoke('download');
  await invoke('deferInstall');
  expect(mocks.setPendingInstall).toHaveBeenCalledWith(true);
  expect((await invoke('install')).phase).toBe('installing');
  expect(mocks.setPendingInstall).toHaveBeenLastCalledWith(false);
  await invoke('install');
  expect(mocks.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
});

it('安装器异步启动失败会解除安装中状态', async () => {
  await invoke('check');
  await invoke('download');
  await invoke('install');
  mocks.listeners.get('error')!(new Error('installer spawn failed'));
  expect(await invoke('state')).toMatchObject({ phase: 'error', failedAt: 'install' });
});

it('清除待装标记失败时不启动安装器', async () => {
  await invoke('check');
  await invoke('download');
  mocks.setPendingInstall.mockImplementationOnce(() => {
    throw new Error('database failure');
  });
  expect((await invoke('install')).phase).toBe('error');
  expect(mocks.quitAndInstall).not.toHaveBeenCalled();
});
