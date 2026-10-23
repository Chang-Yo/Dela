import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { onRemoteChange } from './events';
import { helperSession, helperStates, onHelperState, retryHelper } from './helper';
import {
  browseRemote,
  createRemoteDirectory,
  configHostCandidates,
  listRemotes,
  remoteById,
  targetOf,
  prepareRemote,
  probeConnection,
  remoteDraftSchema,
  remoteIdSchema,
  removeRemote,
  saveRemote,
} from './api';

const saveInputSchema = remoteDraftSchema.extend({ id: remoteIdSchema.nullable().optional() });
const taskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const targetById = (id: unknown) => targetOf(remoteById(remoteIdSchema.parse(id)));

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
    browseRemote(
      remoteDraftSchema.parse(draft),
      z.string().min(1).max(4096).startsWith('/').parse(path),
    ),
  );
  handle('mkdir', (draft, parent, name) =>
    createRemoteDirectory(
      remoteDraftSchema.parse(draft),
      z.string().min(1).max(4096).startsWith('/').parse(parent),
      z
        .string()
        .trim()
        .min(1)
        .max(255)
        .refine(
          (value) => !/[/\0]/.test(value) && value !== '.' && value !== '..',
          '文件夹名不合法',
        )
        .parse(name),
    ),
  );
  handle('config-hosts', () => configHostCandidates());
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
  handle('tasks', (id) => helperSession(targetById(id)).listTasks());
  handle('cancel-task', (id, taskId) =>
    helperSession(targetById(id)).cancelTask(taskIdSchema.parse(taskId)),
  );
  handle('retry', (id) => retryHelper(targetById(id)));
  // 订阅方刚挂上监听时拿不到之前的推送：先回一次当前快照，之后按变化推。
  handle('helper-states', () => helperStates());
  // 通道状态变化 → 广播给窗口。每条连接各一条通道，所以送的是一整份快照
  // （渲染端按目的地对准自己的项目）。
  onHelperState((states) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send('remotes:helper-state', states);
  });
}
