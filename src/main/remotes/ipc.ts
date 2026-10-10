import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { onRemoteChange } from './events';
import { onHelperDegradation } from './helper';
import {
  browseRemote,
  listRemotes,
  prepareRemote,
  probeConnection,
  remoteDraftSchema,
  remoteIdSchema,
  removeRemote,
  saveRemote,
} from './api';

const saveInputSchema = remoteDraftSchema.extend({ id: remoteIdSchema.nullable().optional() });

/** 私钥选择器：默认落在 ~/.ssh（不存在就退回家目录），不按扩展名过滤——
 *  私钥常常没有后缀，按后缀过滤反而会把它们藏起来。 */
async function pickKeyFile(): Promise<string | null> {
  const home = homedir();
  const sshDirectory = join(home, '.ssh');
  const result = await dialog.showOpenDialog({
    title: '选择私钥文件',
    defaultPath: existsSync(sshDirectory) ? sshDirectory : home,
    properties: ['openFile'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

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
  handle('pick-key', () => pickKeyFile());
  // 引导 helper 可能几秒到几十秒（第一次要传产物），进度只能推着走：
  // 与 workspace:remote-change 同款，主进程不记任何状态。
  handle('prepare', (draft) =>
    prepareRemote(remoteDraftSchema.parse(draft), (progress) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.webContents.send('remotes:setup-progress', progress);
    }),
  );
  // 远端工具动过文件系统 → 广播给窗口，目录树据此丢掉那层清单再自动重拉。
  onRemoteChange((path) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('workspace:remote-change', path);
  });
  // helper 通道建起来 / 建不起来 → 广播给窗口，目录树据此显示或撤掉降级提示。
  // 每条连接各一条通道，所以送的是一整份快照（渲染端按目的地对准自己的项目）。
  onHelperDegradation((states) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('remotes:helper-state', states);
  });
}
