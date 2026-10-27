import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  packaged: true,
  setLogin: vi.fn(),
  getLogin: vi.fn(),
  write: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    setLoginItemSettings: state.setLogin,
    getLoginItemSettings: state.getLogin,
  },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(name, handler),
  },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../vsjtu/ipc', () => ({ cancelVideoDownloads: vi.fn() }));
vi.mock('../prefs', () => ({ writeSetting: state.write, savedOpenAtLogin: () => false }));
import { registerSettingsIpc } from '../ipc';

beforeEach(() => {
  vi.resetAllMocks();
  state.packaged = true;
  state.getLogin.mockReturnValue({ openAtLogin: true });
  registerSettingsIpc();
});

describe('macOS 登录项生效确认', () => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform: 'darwin' }));

  it('需要系统批准时不记录开启成功，批准后可以重试', () => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status: 'requires-approval' });
    expect(() => state.handlers.get('settings:set-open-at-login')!({}, true)).toThrow(
      /系统设置.*登录项/,
    );
    expect(state.write).not.toHaveBeenCalled();
    expect(state.handlers.get('settings:get-open-at-login')!({})).toBe(false);

    state.getLogin.mockReturnValue({ openAtLogin: true, status: 'enabled' });
    expect(state.handlers.get('settings:set-open-at-login')!({}, true)).toBe(true);
    expect(state.write).toHaveBeenCalledWith('open-at-login', '1');
  });

  it.each(['not-registered', 'not-found'])('静默注册失败（%s）不返回成功', (status) => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status });
    expect(() => state.handlers.get('settings:set-open-at-login')!({}, true)).toThrow(/未能开启/);
    expect(state.write).not.toHaveBeenCalled();
  });

  it.each([
    { openAtLogin: true, status: 'enabled' },
    { openAtLogin: false, status: 'requires-approval' },
  ])('未移除的登录项不能算关闭成功（$status）', (settings) => {
    state.getLogin.mockReturnValue(settings);
    expect(() => state.handlers.get('settings:set-open-at-login')!({}, false)).toThrow(/未能关闭/);
    expect(state.write).not.toHaveBeenCalled();
  });

  it.each(['not-registered', 'not-found'])('确认未注册后保存关闭状态（%s）', (status) => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status });
    expect(state.handlers.get('settings:set-open-at-login')!({}, false)).toBe(false);
    expect(state.setLogin).toHaveBeenCalledWith({ openAtLogin: false });
    expect(state.write).toHaveBeenCalledWith('open-at-login', '0');
  });

  it('系统调用失败时保留原偏好', () => {
    state.setLogin.mockImplementation(() => {
      throw new Error('registration failed');
    });
    expect(() => state.handlers.get('settings:set-open-at-login')!({}, true)).toThrow(
      'registration failed',
    );
    expect(state.write).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Windows 读取注册表启动项', () => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform: 'win32' }));

  it('按注册时的 --hidden 参数读取 Windows 启动项', () => {
    state.getLogin.mockImplementation((options?: { args?: string[] }) => ({
      openAtLogin: (options?.args ?? []).includes('--hidden'),
    }));
    expect(state.handlers.get('settings:get-open-at-login')!({})).toBe(true);

    state.getLogin.mockReturnValue({ openAtLogin: false });
    expect(state.handlers.get('settings:get-open-at-login')!({})).toBe(false);
  });
});

describe.each(['darwin', 'win32'])('登录启动（%s）', (platform) => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform }));
  it('向系统注册对应平台参数，并按系统状态读取', () => {
    state.handlers.get('settings:set-open-at-login')!({}, true);
    expect(state.setLogin).toHaveBeenCalledWith({
      openAtLogin: true,
      ...(platform === 'win32' ? { args: ['--hidden'] } : {}),
    });
    expect(state.write).toHaveBeenCalledWith('open-at-login', '1');
    expect(state.handlers.get('settings:get-open-at-login')!({})).toBe(true);
  });
  it('开发模式不修改系统启动项', () => {
    state.packaged = false;
    state.handlers.get('settings:set-open-at-login')!({}, false);
    expect(state.setLogin).not.toHaveBeenCalled();
    expect(state.handlers.get('settings:get-open-at-login')!({})).toBe(false);
    expect(state.getLogin).not.toHaveBeenCalled();
  });
});
