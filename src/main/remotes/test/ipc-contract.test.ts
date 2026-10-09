// remotes:* 这条线上，preload 打的通道与主进程注册的通道必须一一对应：两边各写一遍字符串，
// 改一处漏一处只会在真实点击时表现为「一直转圈」，单元测试和类型检查都看不见。
// 工作区那批远端通道（list-remote/read-remote-document/传输/watch）由真窗口冒烟覆盖：
// 它们要连上真实远端才有意义，放进这里只能断言字符串，反而会漏掉「注册了但没人调」。
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ handled: [] as string[], invoked: [] as string[] }));

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
  },
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
      'remotes:list',
      'remotes:probe',
      'remotes:remove',
      'remotes:save',
    ]);

    // 每个方法都真的发一次：少一个方法（或写成别的通道名）这里就对不上。
    await Promise.all([
      remotes.list(),
      remotes.save({ host: 'root@10.0.0.5' }),
      remotes.remove('00000000-0000-4000-8000-000000000000'),
      remotes.probe({ host: 'root@10.0.0.5' }),
      remotes.browse({ host: 'root@10.0.0.5' }, null),
    ]);
    expect([...new Set(state.invoked)].sort()).toEqual(registered);
    expect(state.invoked).toHaveLength(5);
  });
});
