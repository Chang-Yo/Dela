import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import { bindShuiyuan, getShuiyuanState, startShuiyuanAuth, unbindShuiyuan } from './api';

export function registerShuiyuanIpc(): void {
  const handle = (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(`shuiyuan:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event, ...args);
    });
  handle('get-state', () => getShuiyuanState());
  handle('start-auth', (event) => startShuiyuanAuth(event.sender));
  handle('bind', (_event, payload: unknown) => bindShuiyuan(payload));
  handle('unbind', () => unbindShuiyuan());
}
