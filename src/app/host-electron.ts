import {
  BrowserWindow,
  app,
  dialog,
  nativeImage,
  net,
  safeStorage,
  shell,
  type WebContents,
} from 'electron';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CredentialDecryptionError,
  type BundledResource,
  type ClientHandle,
  type Desktop,
  type HostPorts,
  type SecretNamespace,
} from '../main/host';
import { getDatabase } from '../main/database';
import { notifyRunFinished } from '../main/settings/task-notify';
import { storageDirectory } from '../main/storage';
import { locateBash } from '../main/terminal/mingit';
import { workspaceProjects } from '../main/workspace/api';

const secretPath = (namespace: SecretNamespace) =>
  join(app.getPath('userData'), `${namespace}.bin`);

// 加密完成后原子替换；无法解密的旧文件先备份，不因重新配置而丢失恢复机会。
function writeSealed(namespace: SecretNamespace, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  const path = secretPath(namespace);
  const sealed = safeStorage.encryptString(plaintext);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if (existsSync(path)) {
      try {
        safeStorage.decryptString(readFileSync(path));
      } catch {
        copyFileSync(path, `${path}.unreadable-${randomUUID()}.bak`);
      }
    }
    writeFileSync(temporary, sealed);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function readSealed(namespace: SecretNamespace): string | null {
  const path = secretPath(namespace);
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  try {
    return safeStorage.decryptString(readFileSync(path));
  } catch (cause) {
    throw new CredentialDecryptionError(namespace, cause);
  }
}

/** 开发时的位置：helper 与 OpenSSH 入库在 vendor/，rg 由 fetch:remote-rg 下载到 .build/。 */
const bundledInRepo: Record<BundledResource, string> = {
  'dela-helper': join('vendor', 'dela-helper'),
  'remote-rg': join('.build', 'remote-rg'),
  openssh: join('vendor', 'openssh'),
};

const clients = new Set<WebContents>();

const windowOf = (owner: ClientHandle) => BrowserWindow.fromWebContents(owner as WebContents);

const desktop: Desktop = {
  async pickFiles(owner) {
    const window = windowOf(owner);
    if (!window) return [];
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文件', extensions: ['*'] }],
    });
    return result.canceled ? [] : result.filePaths;
  },
  async pickSavePath(owner, { title, defaultPath, extension }) {
    const options = {
      title,
      defaultPath,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    };
    const window = owner && windowOf(owner);
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  },
  reveal: (path) => shell.showItemInFolder(path),
  async open(path) {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
  trash: (path) => shell.trashItem(path),
  sendToWindows(channel) {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel);
  },
};

export const electronPorts: HostPorts = {
  paths: {
    userData: () => app.getPath('userData'),
    home: () => app.getPath('home'),
    documents: () => app.getPath('documents'),
    temp: () => app.getPath('temp'),
    storage: storageDirectory,
    bundled: (name) =>
      app.isPackaged
        ? join(process.resourcesPath, name)
        : join(app.getAppPath(), bundledInRepo[name]),
    bash: locateBash,
  },
  secrets: {
    write: writeSealed,
    read: readSealed,
    remove(namespace) {
      const path = secretPath(namespace);
      if (existsSync(path)) unlinkSync(path);
    },
  },
  notifier: { notifyRunFinished },
  broadcaster: {
    subscribe(client) {
      const target = client as WebContents;
      if (clients.has(target)) return;
      clients.add(target);
      target.once('destroyed', () => clients.delete(target));
    },
    send(channel, ...args) {
      for (const client of clients) if (!client.isDestroyed()) client.send(channel, ...args);
    },
  },
  imageCodec: {
    previewDataUrl(source) {
      const image =
        typeof source === 'string'
          ? nativeImage.createFromPath(source)
          : nativeImage.createFromBuffer(source);
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      return (width > 480 ? image.resize({ width: 480, quality: 'good' }) : image).toDataURL();
    },
  },
  desktop,
  network: { fetch: (url, init) => net.fetch(url, init) },
  database: getDatabase,
  projects: workspaceProjects,
};
