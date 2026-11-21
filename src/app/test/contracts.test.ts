// app 的几份清单各自登记同一批模块：漏登或写错一个，调用被拒或建表记错主人。
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('electron', () => ({ ipcRenderer: { invoke: state.invoke } }));

import { agentContract } from '../../core/protocol/agent';
import { capabilitiesContract } from '../../core/protocol/capabilities';
import { channelsOf } from '../../core/protocol/contract';
import { llmContract } from '../../core/protocol/llm';
import { bridge } from '../preload/bridge';
import { contracts } from '../contracts';
import { modules } from '../modules';
import { schemas } from '../schemas';

it('preload 放行的契约与主进程注册的模块契约一一对应', () => {
  expect(contracts).toEqual([
    agentContract,
    llmContract,
    capabilitiesContract,
    ...modules.flatMap((module) => (module.ipc ? [module.ipc.contract] : [])),
  ]);
});

it('表的主人是 core 或已登记的模块，迁移名以日期开头', () => {
  const owners = ['core', ...modules.map((module) => module.id)];
  for (const schema of schemas) {
    expect(owners).toContain(schema.owner);
    for (const name of Object.keys(schema.migrations ?? {}))
      expect(name).toMatch(/^\d{8}-[a-z0-9-]+$/);
  }
});

it('preload 只转发已登记的通道', async () => {
  const [channel] = contracts.flatMap(channelsOf);
  await bridge.invoke(channel!, 'x');
  expect(state.invoke).toHaveBeenCalledWith(channel, 'x');
  await expect(bridge.invoke('legacy:unregistered', null)).rejects.toThrow('未启用');
});
