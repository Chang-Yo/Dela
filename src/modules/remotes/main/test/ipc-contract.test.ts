// remotes:* 的通道名在 preload 与主进程各写一遍，改一处漏一处只会在真窗口里表现为一直转圈。
// 工作区那批远端通道要连真实远端才有意义，由冒烟覆盖；放进来只能断言字符串。
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handled: [] as string[],
  invoked: [] as string[],
  listened: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string) => {
      state.handled.push(channel);
    },
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      state.invoked.push(channel);
      return Promise.resolve(null);
    },
    on: (channel: string) => {
      state.listened.push(channel);
    },
    removeListener: () => {},
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: () => {} }));

import { registerRemoteIpc } from '../ipc';
import { remotes } from '../../../preload/remotes';

describe('远程 IPC 通道契约', () => {
  it('主进程注册的通道就是 preload 会调用的那些', async () => {
    registerRemoteIpc();
    const registered = [...state.handled].sort();
    expect(registered).toEqual([
      'remotes:browse',
      'remotes:cancel-task',
      'remotes:config-hosts',
      'remotes:helper-states',
      'remotes:list',
      'remotes:mkdir',
      'remotes:pick-key',
      'remotes:prepare',
      'remotes:probe',
      'remotes:remove',
      'remotes:retry',
      'remotes:save',
      'remotes:tasks',
    ]);

    // 每个方法都真的发一次：少一个方法（或写成别的通道名）这里就对不上。
    const remoteId = '00000000-0000-4000-8000-000000000000';
    await Promise.all([
      remotes.list(),
      remotes.save({ host: 'root@10.0.0.5' }),
      remotes.remove(remoteId),
      remotes.probe({ host: 'root@10.0.0.5' }),
      remotes.browse({ host: 'root@10.0.0.5' }, '/'),
      remotes.mkdir({ host: 'root@10.0.0.5' }, '/', 'proj'),
      remotes.configHosts(),
      remotes.pickKey(),
      remotes.prepare({ host: 'root@10.0.0.5' }),
      remotes.tasks(remoteId),
      remotes.cancelTask(remoteId, 'task-1'),
      remotes.retry(remoteId),
    ]);

    // 订阅走的不是 invoke：通道名写错同样只在真窗口里表现为「进度一条都不来」。
    // onHelperState 订阅时补拉一次当前快照（remotes:helper-states）。
    const unsubscribe = remotes.onSetupProgress(() => {});
    const unsubscribeState = remotes.onHelperState(() => {});
    expect([...new Set(state.invoked)].sort()).toEqual(registered);
    expect(state.invoked).toHaveLength(13);
    expect([...new Set(state.listened)].sort()).toEqual([
      'remotes:helper-state',
      'remotes:setup-progress',
    ]);
    unsubscribe();
    unsubscribeState();
  });
});
