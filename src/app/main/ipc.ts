import { ipcMain } from 'electron';
import { hostPorts } from '../../core/ports';
import {
  channelsOf,
  eventChannelsOf,
  type ChannelManifest,
  type Contract,
} from '../../core/protocol/contract';
import { checkWorkspaceSender } from './window';
import type { ModuleDefinition } from '../module';

/** 模块的契约通道只认应用主框架，入参经契约 schema 校验后才交给模块。 */
export function registerModuleIpc(modules: ModuleDefinition[], coreContracts: Contract[]): void {
  ipcMain.handle('contract:subscribe', (event) => {
    checkWorkspaceSender(event);
    hostPorts().broadcaster.subscribe(event.sender);
  });
  for (const { ipc } of modules) {
    if (!ipc) continue;
    for (const name of Object.keys(ipc.contract.procedures)) {
      ipcMain.handle(`${ipc.contract.namespace}:${name}`, (event, input: unknown) => {
        checkWorkspaceSender(event);
        return ipc.call(name, input);
      });
    }
  }
  const contracts = [
    ...coreContracts,
    ...modules.flatMap(({ ipc }) => (ipc ? [ipc.contract] : [])),
  ];
  const manifest: ChannelManifest = {
    channels: contracts.flatMap(channelsOf),
    events: contracts.flatMap(eventChannelsOf),
  };
  // preload 用 sendSync 等这份名单，拒绝时也要回复，否则页面一直卡住。
  ipcMain.on('contract:manifest', (event) => {
    try {
      checkWorkspaceSender(event);
      event.returnValue = manifest;
    } catch {
      event.returnValue = { channels: [], events: [] } satisfies ChannelManifest;
    }
  });
}
