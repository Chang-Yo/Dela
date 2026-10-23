// packages:* 通道：设置页的包管理与聊天界面的扩展交互。装、卸、启停都会让会话按新配置重建
// （空闲的立即丢弃，运行中的跑完这一轮再丢），扩展的 session_shutdown 随 dispose 触发。
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  extensionSessionState,
  replyExtensionUi,
  reportEditorText,
  setExtensionUiSender,
} from './extension-ui';
import {
  disablePackages,
  enablePackages,
  installPackage,
  listPackages,
  onPackageProgress,
  packageInstalledPath,
  packageSettings,
  removePackage,
  restorePackages,
  setPackageEnabled,
  setPackageResources,
  setPromptEnabled,
  setRegistry,
  updatePackage,
} from './packages';
import { cancelNodeInstall } from './npm-runtime';
import { invalidateSessions } from './session';

function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
}

async function invalidating<T>(task: () => Promise<T> | T): Promise<T> {
  try {
    return await task();
  } finally {
    invalidateSessions();
  }
}

const id = z.string().uuid();
const resourcesSchema = z
  .object({ extensions: z.boolean(), skills: z.boolean(), prompts: z.boolean() })
  .strict();

export function registerPackagesIpc() {
  setExtensionUiSender(broadcast);
  onPackageProgress((progress) => broadcast('packages:progress', progress));
  void restorePackages().then(() => broadcast('packages:settings-changed', packageSettings()));

  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`packages:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  const settingsChanged = () => broadcast('packages:settings-changed', packageSettings());

  handle('settings', () => packageSettings());
  handle('enable', () =>
    invalidating(async () => {
      try {
        return await enablePackages(settingsChanged);
      } finally {
        settingsChanged();
      }
    }),
  );
  handle('disable', () =>
    invalidating(() => {
      const next = disablePackages();
      settingsChanged();
      return next;
    }),
  );
  handle('cancel-runtime-install', () => cancelNodeInstall());
  handle('set-registry', (value) => {
    const next = setRegistry(z.enum(['npmjs', 'npmmirror']).parse(value));
    settingsChanged();
    return next;
  });
  handle('list', () => listPackages());
  handle('install', (source) =>
    invalidating(() => installPackage(z.string().trim().min(1).max(4096).parse(source))),
  );
  handle('pick-local', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Pi package 目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('set-enabled', (packageId, enabled) =>
    invalidating(() => setPackageEnabled(id.parse(packageId), z.boolean().parse(enabled))),
  );
  handle('set-resources', (packageId, resources) =>
    invalidating(() => setPackageResources(id.parse(packageId), resourcesSchema.parse(resources))),
  );
  handle('set-prompt-enabled', (name, enabled) =>
    invalidating(() =>
      setPromptEnabled(z.string().trim().min(1).max(200).parse(name), z.boolean().parse(enabled)),
    ),
  );
  handle('update', (packageId) => invalidating(() => updatePackage(id.parse(packageId))));
  handle('remove', (packageId) => invalidating(() => removePackage(id.parse(packageId))));
  handle('reveal', async (packageId) => {
    const path = await packageInstalledPath(id.parse(packageId));
    if (!path) throw new Error('这个包的安装目录不存在');
    shell.showItemInFolder(path);
  });

  handle('ui-reply', (requestId, value) =>
    replyExtensionUi(
      z.string().uuid().parse(requestId),
      z.union([z.string().max(100_000), z.boolean(), z.null()]).parse(value),
    ),
  );
  handle('session-state', (sessionId) => extensionSessionState(id.parse(sessionId)));
  ipcMain.on('packages:editor-text', (event, sessionId, text) => {
    try {
      checkWorkspaceSender(event);
      reportEditorText(id.parse(sessionId), z.string().max(200_000).parse(text));
    } catch {
      // 单向上报，格式不对直接丢弃。
    }
  });
}
