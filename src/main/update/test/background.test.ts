// 后台检查循环：用户不打开设置页时也要能发现新版本，仅在打包版已有窗口时检查。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  windows: [] as {
    isDestroyed: () => boolean;
    webContents: { send: () => void };
  }[],
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  isPackaged: true,
  pendingInstall: false,
  setPendingInstall: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getVersion: () => '1.0.0',
  },
  BrowserWindow: { getAllWindows: () => mocks.windows },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../settings/prefs', () => ({
  savedPendingInstall: () => mocks.pendingInstall,
  setPendingInstall: mocks.setPendingInstall,
}));
vi.mock('electron-updater', () => ({
  autoUpdater: {
    checkForUpdates: mocks.check,
    downloadUpdate: mocks.download,
    quitAndInstall: mocks.install,
    on: () => {},
  },
}));

function liveWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: () => {} },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  vi.useFakeTimers();
  mocks.windows = [liveWindow()];
  mocks.isPackaged = true;
  mocks.pendingInstall = false;
  mocks.setPendingInstall.mockReset();
  mocks.check.mockReset();
  mocks.check.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } });
  mocks.download.mockReset();
  mocks.download.mockResolvedValue(['installer.exe']);
  mocks.install.mockReset();
  mocks.install.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startBackgroundUpdateCheck', () => {
  it('Linux 不注册后台计时器，不恢复或清除待安装标记', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    mocks.pendingInstall = true;
    const { startBackgroundUpdateCheck, BACKGROUND_CHECK_INTERVAL } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_INTERVAL);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.setPendingInstall).not.toHaveBeenCalled();
    stop();
  });
  it('Mac 与 Windows 一样注册后台计时器并检查更新', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const { startBackgroundUpdateCheck, BACKGROUND_CHECK_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_DELAY);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    stop();
  });
  it('等窗口就位后先查一次，之后按间隔查，停止后不再查', async () => {
    const { startBackgroundUpdateCheck, BACKGROUND_CHECK_DELAY, BACKGROUND_CHECK_INTERVAL } =
      await import('../index');
    const stop = startBackgroundUpdateCheck();
    expect(mocks.check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_DELAY - 1);
    expect(mocks.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_INTERVAL);
    expect(mocks.check).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_INTERVAL);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('开发运行不问CDN', async () => {
    mocks.isPackaged = false;
    const { startBackgroundUpdateCheck, BACKGROUND_CHECK_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_DELAY);
    expect(mocks.check).not.toHaveBeenCalled();
    stop();
  });

  it('没有窗口时跳过后台检查', async () => {
    mocks.windows = [];
    const { startBackgroundUpdateCheck, BACKGROUND_CHECK_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(BACKGROUND_CHECK_DELAY);
    expect(mocks.check).not.toHaveBeenCalled();
    stop();
  });
});

// 上次推迟的更新只准备到 ready，由用户再次确认安装。
describe('准备上次推迟的更新', () => {
  const update = { version: '1.0.1' };

  it('启动后只检查和下载，并在准备前清除标记', async () => {
    mocks.pendingInstall = true;
    mocks.check.mockResolvedValue({ isUpdateAvailable: true, updateInfo: update });
    const { startBackgroundUpdateCheck, PENDING_INSTALL_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(PENDING_INSTALL_DELAY);
    expect(mocks.setPendingInstall).toHaveBeenCalledWith(false);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
    stop();
  });

  it('比普通后台检查更早准备上次推迟的更新', async () => {
    const { PENDING_INSTALL_DELAY, BACKGROUND_CHECK_DELAY } = await import('../index');
    expect(PENDING_INSTALL_DELAY).toBeLessThan(BACKGROUND_CHECK_DELAY);
  });

  it('检查耗时两分钟后也不会自动安装', async () => {
    mocks.pendingInstall = true;
    let complete!: (value: unknown) => void;
    mocks.check.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { startBackgroundUpdateCheck } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(120_000);
    complete({ isUpdateAvailable: true, updateInfo: update });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
    stop();
  });

  it('没有标记时这一步什么都不做，只剩普通后台检查', async () => {
    const { startBackgroundUpdateCheck, PENDING_INSTALL_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(PENDING_INSTALL_DELAY);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    stop();
  });

  it('这次查下来已经是最新就停在检查，不空跑下载与安装', async () => {
    mocks.pendingInstall = true;
    const { startBackgroundUpdateCheck, PENDING_INSTALL_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(PENDING_INSTALL_DELAY);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.download).not.toHaveBeenCalled();
    stop();
  });

  it('窗口还没就位就留着标记，下次启动再试', async () => {
    mocks.pendingInstall = true;
    mocks.check.mockResolvedValue({ isUpdateAvailable: true, updateInfo: update });
    mocks.windows = [];
    const { startBackgroundUpdateCheck, PENDING_INSTALL_DELAY } = await import('../index');
    const stop = startBackgroundUpdateCheck();
    await vi.advanceTimersByTimeAsync(PENDING_INSTALL_DELAY);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.setPendingInstall).not.toHaveBeenCalled();
    stop();
  });
});
