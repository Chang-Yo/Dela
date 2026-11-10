// preload 白名单只认 contracts.ts，主进程注册看 modules.ts：两份清单漏登一个，调用就会被拒。
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('electron', () => ({ ipcRenderer: { invoke: state.invoke } }));

import { channelsOf } from '../../core/protocol/contract';
import { bridge } from '../../preload/bridge';
import { contracts } from '../contracts';
import { modules } from '../modules';

it('preload 放行的契约与主进程注册的模块契约一一对应', () => {
  expect(contracts).toEqual(modules.flatMap((module) => (module.ipc ? [module.ipc.contract] : [])));
});

it('preload 只转发已登记的通道', async () => {
  const [channel] = contracts.flatMap(channelsOf);
  await bridge.invoke(channel!, 'x');
  expect(state.invoke).toHaveBeenCalledWith(channel, 'x');
  await expect(bridge.invoke('backup:export', null)).rejects.toThrow('未登记的通道');
});
