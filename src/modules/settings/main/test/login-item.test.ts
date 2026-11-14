import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
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
}));
vi.mock('../../../../main/ipc', () => ({ workspaceWindow: () => undefined }));
vi.mock('../prefs', () => ({ writeSetting: state.write, savedOpenAtLogin: () => false }));
import { openAtLogin, setOpenAtLogin } from '../system';

beforeEach(() => {
  vi.resetAllMocks();
  state.packaged = true;
  state.getLogin.mockReturnValue({ openAtLogin: true });
});

describe('macOS 登录项生效确认', () => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform: 'darwin' }));

  it('需要系统批准时不记录开启成功，批准后可以重试', () => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status: 'requires-approval' });
    expect(() => setOpenAtLogin(true)).toThrow(/系统设置.*登录项/);
    expect(state.write).not.toHaveBeenCalled();
    expect(openAtLogin()).toBe(false);

    state.getLogin.mockReturnValue({ openAtLogin: true, status: 'enabled' });
    expect(setOpenAtLogin(true)).toBe(true);
    expect(state.write).toHaveBeenCalledWith('open-at-login', '1');
  });

  it.each(['not-registered', 'not-found'])('静默注册失败（%s）不返回成功', (status) => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status });
    expect(() => setOpenAtLogin(true)).toThrow(/未能开启/);
    expect(state.write).not.toHaveBeenCalled();
  });

  it.each([
    { openAtLogin: true, status: 'enabled' },
    { openAtLogin: false, status: 'requires-approval' },
  ])('未移除的登录项不能算关闭成功（$status）', (settings) => {
    state.getLogin.mockReturnValue(settings);
    expect(() => setOpenAtLogin(false)).toThrow(/未能关闭/);
    expect(state.write).not.toHaveBeenCalled();
  });

  it.each(['not-registered', 'not-found'])('确认未注册后保存关闭状态（%s）', (status) => {
    state.getLogin.mockReturnValue({ openAtLogin: false, status });
    expect(setOpenAtLogin(false)).toBe(false);
    expect(state.setLogin).toHaveBeenCalledWith({ openAtLogin: false });
    expect(state.write).toHaveBeenCalledWith('open-at-login', '0');
  });

  it('系统调用失败时保留原偏好', () => {
    state.setLogin.mockImplementation(() => {
      throw new Error('registration failed');
    });
    expect(() => setOpenAtLogin(true)).toThrow('registration failed');
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
    expect(openAtLogin()).toBe(true);

    state.getLogin.mockReturnValue({ openAtLogin: false });
    expect(openAtLogin()).toBe(false);
  });
});

describe.each(['darwin', 'win32'])('登录启动（%s）', (platform) => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform }));
  it('向系统注册对应平台参数，并按系统状态读取', () => {
    setOpenAtLogin(true);
    expect(state.setLogin).toHaveBeenCalledWith({
      openAtLogin: true,
      ...(platform === 'win32' ? { args: ['--hidden'] } : {}),
    });
    expect(state.write).toHaveBeenCalledWith('open-at-login', '1');
    expect(openAtLogin()).toBe(true);
  });
  it('开发模式不修改系统启动项', () => {
    state.packaged = false;
    setOpenAtLogin(false);
    expect(state.setLogin).not.toHaveBeenCalled();
    expect(openAtLogin()).toBe(false);
    expect(state.getLogin).not.toHaveBeenCalled();
  });
});
