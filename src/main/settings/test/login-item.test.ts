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
  vi.clearAllMocks();
  state.packaged = true;
  state.getLogin.mockReturnValue({ openAtLogin: true });
  registerSettingsIpc();
});
afterEach(() => vi.unstubAllGlobals());

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
