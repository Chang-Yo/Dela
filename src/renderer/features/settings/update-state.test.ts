// @vitest-environment jsdom
// 更新快照的渲染层镜像：标题栏与设置页共用同一份，整个应用只挂一次订阅。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../shared/api';
import type { UpdateSnapshot } from '../../../shared/update';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../app/toasts', () => ({ showToast: toast }));

const base: UpdateSnapshot = {
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  bytesPerSecond: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

const available: UpdateSnapshot = { ...base, phase: 'available', version: '1.0.1' };

let listeners: ((state: UpdateSnapshot) => void)[];
let unsubscribe: ReturnType<typeof vi.fn>;
let getState: ReturnType<typeof vi.fn>;

/** 装一个 preload 桥；getState 的实现可替换，用来模拟读取失败。 */
function mountApi(read: () => Promise<UpdateSnapshot> = async () => base) {
  getState = vi.fn(read);
  window.dela = {
    session: { onRunEvent: () => () => {} },
    update: {
      getState,
      check: async () => base,
      download: async () => base,
      install: async () => base,
      openDownloadPage: async () => {},
      onState: (listener: (state: UpdateSnapshot) => void) => {
        listeners.push(listener);
        return unsubscribe;
      },
    },
  } as unknown as DelaApi;
}

beforeEach(() => {
  vi.resetModules();
  toast.mockClear();
  listeners = [];
  unsubscribe = vi.fn();
  mountApi();
});

async function load() {
  const { useUpdateState } = await import('./update');
  return useUpdateState;
}

describe('useUpdateState', () => {
  it('挂载后先读一次当前快照，再接收后续推送', async () => {
    const store = await load();
    store.getState().attach();
    await vi.waitFor(() => expect(store.getState().snapshot).toEqual(base));
    expect(listeners).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    listeners[0]?.(available);
    expect(store.getState().snapshot).toEqual(available);
  });

  it('重复挂载只订阅一次：设置页与标题栏读的是同一份', async () => {
    const store = await load();
    store.getState().attach();
    store.getState().attach();
    await vi.waitFor(() => expect(store.getState().snapshot).toEqual(base));
    expect(listeners).toHaveLength(1);
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it('安装器重启后只提示一次实际运行版本', async () => {
    window.dela = { ...window.dela, version: '1.0.2', updatedOnLaunch: true } as DelaApi;
    const store = await load();
    store.getState().attach();
    store.getState().attach();
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      title: '已更新至 Dela 1.0.2',
    });
  });

  it('浏览器预览没有 preload 时保持空快照，不抛异常', async () => {
    delete window.dela;
    const store = await load();
    expect(() => store.getState().attach()).not.toThrow();
    expect(store.getState().snapshot).toBeNull();
  });

  it('安装器异步失败时提示手动安装，重复广播不重复提示', async () => {
    const store = await load();
    store.getState().attach();
    await vi.waitFor(() => expect(store.getState().snapshot).toEqual(base));
    const failure: UpdateSnapshot = {
      ...base,
      phase: 'error',
      failedAt: 'install',
      reason: 'failed',
    };
    listeners[0]?.(failure);
    listeners[0]?.({ ...failure });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0].description).toContain('手动安装');
  });

  it('读取失败不把快照改成错误态，交给标题栏保持安静', async () => {
    mountApi(async () => {
      throw new Error('IPC 断了');
    });
    const store = await load();
    store.getState().attach();
    await vi.waitFor(() => expect(getState).toHaveBeenCalled());
    expect(store.getState().snapshot).toBeNull();
  });
});
