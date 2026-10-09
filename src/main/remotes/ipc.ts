import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { onRemoteChange } from './events';
import {
  browseRemote,
  listRemotes,
  probeConnection,
  remoteDraftSchema,
  remoteIdSchema,
  removeRemote,
  saveRemote,
} from './api';

const saveInputSchema = remoteDraftSchema.extend({ id: remoteIdSchema.nullable().optional() });

export function registerRemoteIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`remotes:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('list', () => listRemotes());
  handle('save', (draft) => saveRemote(saveInputSchema.parse(draft)));
  handle('remove', (id) => removeRemote(remoteIdSchema.parse(id)));
  handle('probe', (draft) => probeConnection(remoteDraftSchema.parse(draft)));
  handle('browse', (draft, path) =>
    browseRemote(remoteDraftSchema.parse(draft), z.string().max(4096).nullable().parse(path)),
  );
  // 远端工具动过文件系统 → 广播给窗口，目录树据此丢掉那层清单再自动重拉。
  onRemoteChange((path) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('workspace:remote-change', path);
  });
}
