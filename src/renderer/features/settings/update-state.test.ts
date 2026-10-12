// @vitest-environment jsdom
// 更新快照的渲染层镜像：标题栏与设置页共用同一份，整个应用只挂一次订阅。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../shared/api';
import type { UpdateSnapshot } from '../../../shared/update';

const base: UpdateSnapshot = {
  phase: 'idle',
  channel: 'store',
  currentVersion: '1.0.0',
  version: null,
  mandatory: false,
  progress: 0,
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
    update: {
      getState,
      check: async () => base,
      download: async () => base,
      install: async () => base,
      openStorePage: async () => {},
      onState: (listener: (state: UpdateSnapshot) => void) => {
        listeners.push(listener);
        return unsubscribe;
      },
    },
  } as unknown as DelaApi;
}

beforeEach(() => {
  vi.resetModules();
  listeners = [];
  unsubscribe = vi.fn();
  mountApi();
});

async function load() {
  const { useUpdateState } = await import('./update-state');
  return useUpdateState;
}

describe('useUpdateState', () => {
  it('挂载后先读一次当前快照，再接收后续推送', async () => {
    const store = await load();
    store.getState().attach();
    await vi.waitFor(() => expect(store.getState().snapshot).toEqual(base));
    expect(listeners).toHaveLength(1);
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

  it('浏览器预览没有 preload 时保持空快照，不抛异常', async () => {
    delete window.dela;
    const store = await load();
    expect(() => store.getState().attach()).not.toThrow();
    expect(store.getState().snapshot).toBeNull();
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
