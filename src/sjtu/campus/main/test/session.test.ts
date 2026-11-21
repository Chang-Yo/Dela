// 校园登录窗共用逻辑：到达目标域后探活收场。课堂视频入口页本身就在目标域（retryProbe）：
// 未登录时探测失败不得关窗，覆盖 SSO 回跳、SPA 导航和异步登录；课表探测失败即关窗返回错误。
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions, Session, WebContents } from 'electron';

const mock = vi.hoisted(() => ({
  userData: '',
  lastWindow: undefined as unknown,
  windows: [] as unknown[],
  parent: {} as unknown,
  load: vi.fn<() => Promise<void>>(),
  netRequest: vi.fn(),
}));

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
    minimized = false;
    focus = vi.fn();
    show = vi.fn();
    restore = vi.fn(() => {
      this.minimized = false;
    });
    constructor(readonly options: BrowserWindowConstructorOptions) {
      mock.lastWindow = this;
      mock.windows.push(this);
    }
    on(event: string, listener: (...args: unknown[]) => void): void {
      this.emitter.on(event, listener);
    }
    emit(event: string, ...args: unknown[]): void {
      this.emitter.emit(event, ...args);
    }
    async loadURL(): Promise<void> {
      await mock.load();
    }
    isDestroyed(): boolean {
      return this.closeCalled;
    }
    isMinimized(): boolean {
      return this.minimized;
    }
    close(): void {
      if (this.closeCalled) return;
      this.closeCalled = true;
      this.emit('closed');
    }
  }
  return {
    BrowserWindow: Object.assign(MockWindow, { fromWebContents: () => mock.parent }),
    app: { getPath: () => mock.userData },
    net: { request: mock.netRequest },
    safeStorage: { isEncryptionAvailable: () => true },
    session: {
      fromPartition: () => ({
        cookies: { get: async () => [], on: () => {} },
      }),
    },
  };
});
vi.mock('../../../../modules/workspace', () => ({ attachContextMenu: () => {} }));

import {
  CampusAuthError,
  campusRequest,
  createCampusLoginWindow,
  openCampusLoginWindow,
} from '../session';

interface LoginWindowMock {
  webContents: { emit: (event: string, ...args: unknown[]) => void };
  loadURL: () => Promise<void>;
  close: () => void;
  closeCalled: boolean;
  minimized: boolean;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  options: BrowserWindowConstructorOptions;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sender = {} as WebContents;
const asWindow = (): LoginWindowMock => mock.lastWindow as LoginWindowMock;

beforeEach(() => {
  mock.userData = mkdtempSync(join(tmpdir(), 'dela-session-'));
  mock.lastWindow = undefined;
  mock.windows = [];
  mock.parent = {};
  mock.load.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const window of mock.windows as LoginWindowMock[]) window.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(['darwin', 'win32'])('校园窗口平台边界（%s）', (platform) => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform }));

  it('Mac 保留普通窗口关闭入口，Windows 保持模态；远端网页不获得 preload', () => {
    createCampusLoginWindow(sender, '登录测试');
    const options = asWindow().options;
    expect(options.modal).toBe(platform !== 'darwin');
    expect(options.parent).toBe(mock.parent);
    expect(options.frame).not.toBe(false);
    expect(options.closable).not.toBe(false);
    expect(options.webPreferences).toEqual({
      partition: 'persist:dela-campus',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});

describe('openCampusLoginWindow', () => {
  it('并发打开同一入口只创建一窗，复用结果并唤回最小化窗口', async () => {
    const options = {
      sender,
      title: '登录测试',
      url: 'https://v.sjtu.edu.cn/',
      reached: () => false,
      probe: vi.fn(),
    };
    const first = openCampusLoginWindow(options);
    await flush();
    asWindow().minimized = true;
    const second = openCampusLoginWindow(options);
    await flush();
    expect(mock.windows).toHaveLength(1);
    expect(asWindow().restore).toHaveBeenCalledOnce();
    expect(asWindow().show).toHaveBeenCalledOnce();
    expect(asWindow().focus).toHaveBeenCalledOnce();
    asWindow().close();
    await expect(first).resolves.toEqual({ ok: false, error: '未完成登录' });
    await expect(second).resolves.toEqual({ ok: false, error: '未完成登录' });
    const retry = openCampusLoginWindow(options);
    await flush();
    expect(mock.windows).toHaveLength(2);
    asWindow().close();
    await expect(retry).resolves.toEqual({ ok: false, error: '未完成登录' });
  });

  it('无后续导航的异步登录也会重探，成功后停止重试', async () => {
    vi.useFakeTimers();
    let authenticated = false;
    const pending = openCampusLoginWindow({
      sender,
      title: '登录交大视频',
      url: 'https://v.sjtu.edu.cn/',
      reached: (url) => url.startsWith('https://v.sjtu.edu.cn/'),
      retryProbe: true,
      probe: async () => {
        if (!authenticated) throw new Error('未登录');
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const loginWindow = asWindow();
    loginWindow.webContents.emit('did-navigate', {}, 'https://v.sjtu.edu.cn/');
    await vi.advanceTimersByTimeAsync(0);
    authenticated = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(loginWindow.closeCalled).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

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
});

describe('campusRequest', () => {
  const url = 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsgrkb.html';
  const options = { service: '课表', loginError: '登录已失效，请重新登录' };

  function mockRequest(status: number | 'redirect' | 'error', body = '') {
    const request = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(),
      abort: vi.fn(),
      end: vi.fn(() =>
        queueMicrotask(() => {
          if (status === 'redirect') {
            request.emit('redirect', 302);
            return;
          }
          if (status === 'error') {
            request.emit('error', new Error('network failed'));
            return;
          }
          const response = Object.assign(new EventEmitter(), { statusCode: status });
          request.emit('response', response);
          response.emit('data', Buffer.from(body));
          response.emit('end');
        }),
      ),
    });
    mock.netRequest.mockReturnValue(request);
    return request;
  }

  it('正常回应解析正文，会话内手动重定向', async () => {
    const request = mockRequest(200, '{"kbList":[]}');
    await expect(campusRequest({} as Session, url, options)).resolves.toBe('{"kbList":[]}');
    expect(mock.netRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url, method: 'GET', useSessionCookies: true, redirect: 'manual' }),
    );
    expect(request.abort).not.toHaveBeenCalled();
  });

  it.each(['redirect', 401, 403] as const)('%s 回应抛登录失效错误', async (status) => {
    const request = mockRequest(status);
    let caught: unknown;
    await campusRequest({} as Session, url, options).catch((error) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(CampusAuthError);
    expect((caught as Error).message).toBe('登录已失效，请重新登录');
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('接口自定的未登录状态码即使超出 HTTP 范围也按登录失效处理', async () => {
    mockRequest(901);
    let caught: unknown;
    await campusRequest({} as Session, url, { ...options, loginStatus: 901 }).catch((error) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(CampusAuthError);
  });

  it('408/5xx 标记可重试，其余状态不标记', async () => {
    const unavailable = mockRequest(503);
    let caught: unknown;
    await campusRequest({} as Session, url, options).catch((error) => {
      caught = error;
    });
    expect((caught as Error).message).toBe('课表接口返回 503');
    expect((caught as Error).cause).toBe('transient');
    expect(unavailable.abort).toHaveBeenCalledOnce();

    const missing = mockRequest(404);
    await campusRequest({} as Session, url, options).catch((error) => {
      caught = error;
    });
    expect((caught as Error).message).toBe('课表接口返回 404');
    expect((caught as Error).cause).toBeUndefined();
    expect(missing.abort).toHaveBeenCalledOnce();
  });

  it('超时后中断请求', async () => {
    vi.useFakeTimers();
    const request = mockRequest(200);
    request.end.mockImplementation(() => {});
    let caught: unknown;
    // reject 发生在推进计时器期间，须先挂上处理器避免 unhandled rejection。
    campusRequest({} as Session, url, options).catch((error) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect((caught as Error).message).toBe('课表请求超时，请稍后重试');
    expect((caught as Error).cause).toBe('transient');
    expect(request.abort).toHaveBeenCalledOnce();
  });
});
