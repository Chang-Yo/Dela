// @vitest-environment jsdom
// 更新快照的渲染层镜像：标题栏与设置页共用同一份，整个应用只挂一次订阅。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateSnapshot } from '../../contract';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../../renderer/app/toasts', () => ({ showToast: toast }));

const base: UpdateSnapshot = {
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  progress: 0,
  transferred: 0,
  total: null,
  checkedAt: null,
  reason: null,
  detail: null,
  failedAt: null,
};

const available: UpdateSnapshot = { ...base, phase: 'available', version: '1.0.1' };

// 契约客户端在模块加载时取桥，所以桥先于导入装好，各用例只替换它转发到的实现。
const harness = vi.hoisted(() => {
  const state = {
    listeners: [] as ((snapshot: unknown) => void)[],
    procedures: {} as Record<string, () => Promise<unknown>>,
  };
  const bridge = {
    invoke: (channel: string) => state.procedures[channel]!(),
    subscribe: (channel: string, listener: (snapshot: unknown) => void) => {
      if (channel === 'update:state') state.listeners.push(listener);
      return () => {};
    },
  };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return { state, bridge };
});

import { runUpdateAction, startUpdateMirror, useUpdateState } from '../update';

const getState = vi.fn<() => Promise<UpdateSnapshot>>();

function push(snapshot: UpdateSnapshot) {
  for (const listener of harness.state.listeners) listener(snapshot);
}

beforeEach(() => {
  toast.mockClear();
  harness.state.listeners = [];
  getState.mockReset().mockResolvedValue(base);
  harness.state.procedures = {
    'update:state': getState,
    'update:check': async () => base,
    'update:download': async () => base,
    'update:install': async () => base,
    'update:openDownloadPage': async () => {},
  };
  window.dela = { bridge: harness.bridge } as unknown as NonNullable<typeof window.dela>;
  useUpdateState.setState({ snapshot: null, preparingInstall: false, dismissedVersion: null });
});

describe('useUpdateState', () => {
  it('挂载后先读一次当前快照，再接收后续推送', async () => {
    startUpdateMirror();
    await vi.waitFor(() => expect(useUpdateState.getState().snapshot).toEqual(base));
    expect(harness.state.listeners).toHaveLength(1);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    push(available);
    expect(useUpdateState.getState().snapshot).toEqual(available);
  });

  it('迟到的初始下载快照不能覆盖已经推送的 ready 状态', async () => {
    let resolve!: (snapshot: UpdateSnapshot) => void;
    getState.mockReturnValue(
      new Promise<UpdateSnapshot>((done) => {
        resolve = done;
      }),
    );
    startUpdateMirror();
    const ready: UpdateSnapshot = { ...available, phase: 'ready', progress: 1 };
    push(ready);
    resolve({ ...available, phase: 'downloading', progress: 1 });
    await Promise.resolve();
    expect(useUpdateState.getState().snapshot).toEqual(ready);
  });

  it('漏掉 ready 广播时使用下载回执补齐，随后能显示安装入口', async () => {
    const ready: UpdateSnapshot = { ...available, phase: 'ready', progress: 1 };
    harness.state.procedures['update:download'] = async () => ready;
    useUpdateState.setState({ snapshot: { ...available, phase: 'downloading', progress: 1 } });
    expect(await runUpdateAction('download')).toBe(true);
    expect(useUpdateState.getState().snapshot).toEqual(ready);
    useUpdateState.setState({ snapshot: { ...ready, phase: 'installing' } });
    await runUpdateAction('download');
    expect(useUpdateState.getState().snapshot?.phase).toBe('installing');
  });

  it('安装器重启后提示实际运行版本', () => {
    window.dela = { ...window.dela!, version: '1.0.2', updatedOnLaunch: true };
    startUpdateMirror();
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      variant: 'success',
      title: '已更新至 Dela 1.0.2',
    });
  });

  it('浏览器预览没有 preload 时保持空快照，不抛异常', () => {
    delete window.dela;
    expect(() => startUpdateMirror()).not.toThrow();
    expect(useUpdateState.getState().snapshot).toBeNull();
  });

  it('安装器异步失败时提示手动安装，重复广播不重复提示', async () => {
    startUpdateMirror();
    await vi.waitFor(() => expect(useUpdateState.getState().snapshot).toEqual(base));
    const failure: UpdateSnapshot = {
      ...base,
      phase: 'error',
      failedAt: 'install',
      reason: 'failed',
    };
    push(failure);
    push({ ...failure });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0].description).toContain('手动安装');
  });

  it('读取失败不把快照改成错误态，交给标题栏保持安静', async () => {
    getState.mockRejectedValue(new Error('IPC 断了'));
    startUpdateMirror();
    await vi.waitFor(() => expect(getState).toHaveBeenCalled());
    expect(useUpdateState.getState().snapshot).toBeNull();
  });
});
