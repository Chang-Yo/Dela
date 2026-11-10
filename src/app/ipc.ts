import { ipcMain } from 'electron';
import { checkWorkspaceSender } from '../main/ipc';
import type { ModuleDefinition } from './module';

/** 模块的契约通道只认应用主框架，入参经契约 schema 校验后才交给模块。 */
export function registerModuleIpc(modules: ModuleDefinition[]): void {
  for (const { ipc } of modules) {
    if (!ipc) continue;
    for (const name of Object.keys(ipc.contract.procedures)) {
      ipcMain.handle(`${ipc.contract.namespace}:${name}`, (event, input: unknown) => {
        checkWorkspaceSender(event);
        return ipc.call(name, input);
      });
    }
  }
}
