// 校园登录窗共用逻辑：到达目标域后探活收场。课堂视频的入口页本身就在目标域
// （retryProbe）：首次导航必然未登录，探测失败不得关窗，等 jAccount SSO 回跳后再探；
// 课表默认语义（加载登录页、到达即视为登录完成）探测失败即关窗返回错误。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

const mock = vi.hoisted(() => ({ userData: '', lastWindow: undefined as unknown }));

// 工厂在 import 初始化前执行，不能引用 node:events（会在提升期解引用未初始化绑定），
// 事件器就地实现。
vi.mock('electron', () => {
  const createEmitter = () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    return {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      emit: (event: string, ...args: unknown[]) => {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      },
    };
  };
  class MockWindow {
    private readonly emitter = createEmitter();
    readonly webContents = createEmitter();
    closeCalled = false;
    constructor() {
      mock.lastWindow = this;
    }
    on(event: string, listener: (...args: unknown[]) => void): void {
      this.emitter.on(event, listener);
    }
    emit(event: string, ...args: unknown[]): void {
      this.emitter.emit(event, ...args);
    }
    async loadURL(): Promise<void> {}
    isDestroyed(): boolean {
      return false;
    }
    close(): void {
      this.closeCalled = true;
      this.emit('closed');
    }
  }
  return {
    BrowserWindow: Object.assign(MockWindow, { fromWebContents: () => null }),
    app: { getPath: () => mock.userData },
    safeStorage: { isEncryptionAvailable: () => true },
    session: {
      fromPartition: () => ({
        cookies: { get: async () => [], on: () => {} },
      }),
    },
  };
});
vi.mock('../../ipc', () => ({ attachContextMenu: () => {} }));

import { openCampusLoginWindow } from '../session';

interface LoginWindowMock {
  webContents: { emit: (event: string, ...args: unknown[]) => void };
  loadURL: () => Promise<void>;
  close: () => void;
  closeCalled: boolean;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sender = {} as WebContents;
const asWindow = (): LoginWindowMock => mock.lastWindow as LoginWindowMock;

beforeEach(() => {
  mock.userData = mkdtempSync(join(tmpdir(), 'dela-session-'));
  mock.lastWindow = undefined;
});

describe('openCampusLoginWindow', () => {
  it('retryProbe（课堂视频）：入口页即目标域，未登录探测失败不关窗，SSO 回跳后再探成功', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('校园会话已失效，请重新登录'))
      .mockResolvedValue(undefined);
    const pending = openCampusLoginWindow({
      sender,
      title: '登录交大视频',
      url: 'https://v.sjtu.edu.cn/',
      reached: (url) => url.startsWith('https://v.sjtu.edu.cn/'),
      retryProbe: true,
      probe,
    });
    await flush();
    const loginWindow = asWindow();
    await loginWindow.loadURL();

    loginWindow.webContents.emit('did-navigate', {}, 'https://v.sjtu.edu.cn/');
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(loginWindow.closeCalled).toBe(false);

    // 登录页自身不在目标域语义内，不触发探测。
    loginWindow.webContents.emit('did-navigate', {}, 'https://jaccount.sjtu.edu.cn/jaccount/login');
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);

    loginWindow.webContents.emit('did-navigate', {}, 'https://v.sjtu.edu.cn/?ticket=x');
    await expect(pending).resolves.toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(loginWindow.closeCalled).toBe(true);
  });

  it('默认语义（课表）：到达目标域后探活失败即关窗返回错误', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('课表接口失败'));
    const pending = openCampusLoginWindow({
      sender,
      title: '登录课表',
      url: 'https://i.sjtu.edu.cn/',
      reached: (url) => url.includes('i.sjtu.edu.cn') && !url.includes('jaccountlogin'),
      probe,
    });
    await flush();
    const loginWindow = asWindow();
    await loginWindow.loadURL();

    loginWindow.webContents.emit('did-navigate', {}, 'https://i.sjtu.edu.cn/jsxsd/');
    await expect(pending).resolves.toEqual({ ok: false, error: '课表接口失败' });
    expect(loginWindow.closeCalled).toBe(true);
  });

  it('用户直接关闭窗口按未完成登录收场', async () => {
    const pending = openCampusLoginWindow({
      sender,
      title: '登录交大视频',
      url: 'https://v.sjtu.edu.cn/',
      reached: (url) => url.startsWith('https://v.sjtu.edu.cn/'),
      retryProbe: true,
      probe: vi.fn().mockRejectedValue(new Error('校园会话已失效，请重新登录')),
    });
    await flush();
    const loginWindow = asWindow();
    await loginWindow.loadURL();
    loginWindow.close();
    await expect(pending).resolves.toEqual({ ok: false, error: '未完成登录' });
  });
});
