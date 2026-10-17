import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instances: [] as unknown[],
  parent: { id: 'parent' },
  getCampusSession: vi.fn(async () => ({})),
}));

vi.mock('electron', () => {
  class MockBrowserWindow {
    destroyed = false;
    options: Record<string, unknown>;
    windowListeners = new Map<string, () => void>();
    webListeners = new Map<string, (...args: unknown[]) => void>();
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(async () => {});
    webContents = {
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) =>
        this.webListeners.set(name, listener),
      ),
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.instances.push(this);
    }

    on(name: string, listener: () => void) {
      this.windowListeners.set(name, listener);
    }

    isDestroyed() {
      return this.destroyed;
    }

    close = vi.fn(() => {
      this.destroyed = true;
      this.windowListeners.get('closed')?.();
    });
  }

  return {
    BrowserWindow: Object.assign(MockBrowserWindow, {
      fromWebContents: () => mocks.parent,
    }),
  };
});
vi.mock('../../campus', () => ({
  CAMPUS_PARTITION: 'persist:campus',
  getCampusSession: mocks.getCampusSession,
}));
vi.mock('../../credentials', () => ({
  clearShuiyuanCredential: vi.fn(),
  loadShuiyuanCredential: vi.fn(() => null),
  saveShuiyuanCredential: vi.fn(),
}));
vi.mock('../../ipc', () => ({ attachContextMenu: vi.fn() }));

import { startShuiyuanAuth } from '../api';

interface AuthWindowMock {
  options: { modal?: boolean; parent?: unknown };
  webListeners: Map<string, (...args: unknown[]) => void>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

describe('水源授权窗口', () => {
  it('macOS 使用可关闭的非模态窗口，重复发起时复用，并支持 Escape 退出', async () => {
    await startShuiyuanAuth({} as never);
    const authWindow = mocks.instances[0] as AuthWindowMock;
    expect(authWindow.options.parent).toBe(mocks.parent);
    expect(authWindow.options.modal).toBe(process.platform !== 'darwin');

    await startShuiyuanAuth({} as never);
    expect(mocks.instances).toHaveLength(1);
    expect(authWindow.show).toHaveBeenCalledOnce();
    expect(authWindow.focus).toHaveBeenCalledOnce();

    const preventDefault = vi.fn();
    authWindow.webListeners.get('before-input-event')?.(
      { preventDefault },
      { type: 'keyDown', key: 'Escape' },
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(authWindow.close).toHaveBeenCalledOnce();
  });
});
