// preload 的通道名单由主进程按实际注册的契约下发（docs/adr/0026）：漏下发一个，对应调用就会被拒。
import type { IpcMainEvent } from 'electron';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handled: [] as string[],
  listeners: new Map<string, (event: IpcMainEvent) => void>(),
  invoke: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (channel: string) => state.handled.push(channel),
    on: (channel: string, listener: (event: IpcMainEvent) => void) =>
      state.listeners.set(channel, listener),
  },
  ipcRenderer: {
    sendSync: () => ({ channels: ['todo:list', 'todo:add'], events: ['todo:list', 'todo:due'] }),
    invoke: state.invoke,
  },
}));
vi.mock('../../core/agent/session/store', async (original) => ({
  ...(await original()),
  preloadPi: async () => {},
}));
vi.mock('../../core/config-files', async (original) => ({
  ...(await original()),
  watchConfigFiles: () => () => {},
}));

import { registerAgentIpc } from '../main/agent-ipc';
import { registerModuleIpc } from '../main/ipc';
import { modules } from '../modules';
import { bridge } from '../preload/bridge';

function requestManifest(url: string, fromMainFrame = true) {
  const frame = { url };
  const event = {
    sender: { mainFrame: fromMainFrame ? frame : {} },
    senderFrame: frame,
    returnValue: undefined as unknown,
  };
  state.listeners.get('contract:manifest')!(event as unknown as IpcMainEvent);
  return event.returnValue;
}

registerModuleIpc(modules, registerAgentIpc());

it('下发的过程名单与主进程注册的通道一致', () => {
  const manifest = requestManifest('file:///app/out/renderer/index.html') as { channels: string[] };
  const registered = state.handled.filter((channel) => channel !== 'contract:subscribe');
  expect(manifest.channels.toSorted()).toEqual(registered.toSorted());
});

it('被拒绝的来源拿到空名单', () => {
  expect(requestManifest('https://example.com/')).toEqual({ channels: [], events: [] });
  expect(requestManifest('file:///app/out/renderer/index.html', false)).toEqual({
    channels: [],
    events: [],
  });
});

it('preload 只放行名单内的通道', async () => {
  await bridge.invoke('todo:list', 'x');
  expect(state.invoke).toHaveBeenCalledWith('todo:list', 'x');
  await expect(bridge.invoke('legacy:unregistered', null)).rejects.toThrow('未启用');
  expect(() => bridge.subscribe('legacy:unregistered', () => {})).toThrow('未登记');
  expect(bridge.queryEvents).toEqual(['todo:list']);
});
