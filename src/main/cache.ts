import { app, ipcMain, session } from 'electron';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheClearResult } from '../shared/cache';
import { CAMPUS_PARTITION } from './campus';
import { checkWorkspaceSender } from './ipc';

/**
 * Chromium 的可再生缓存目录名单：本机实测占应用数据目录的 97%。按名字在每一层认，分区里真正
 * 属于用户的数据（Local Storage、IndexedDB、Preferences）不动；`backup.ts` 导出时跳过同一份
 * 名单，两处必须同源。Crashpad 与 logs 不是缓存，但同样只对本机有意义、可随时再生，一并算进来。
 */
export const cacheDirectoryNames = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'CacheStorage',
  'ScriptCache',
  'Crashpad',
  'logs',
]);

/** 整棵目录的字节数；链接不跟（junction 也算链接，避免量到目录树外面去）。 */
async function treeBytes(directory: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      total += info.isDirectory() ? await treeBytes(path) : info.size;
    } catch {
      // 读不到的条目按 0 计：宁可少报一点，也不要整块统计失败。
    }
  }
  return total;
}

/** 只统计名单里的缓存目录，其余目录继续往下找（分区里的同名目录也算）。 */
async function cacheBytes(directory: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      total += cacheDirectoryNames.has(name) ? await treeBytes(path) : await cacheBytes(path);
    } catch {
      // 同上：读不到的目录跳过。
    }
  }
  return total;
}

/** 删掉名单里的缓存目录，其余目录继续往下找。返回是否有内容没能删掉。 */
async function removeCaches(directory: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    // 连目录都读不到（被占住）也算没清干净。
    return true;
  }
  let blocked = false;
  for (const name of names) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      if (cacheDirectoryNames.has(name)) await rm(path, { recursive: true, force: true });
      else blocked = (await removeCaches(path)) || blocked;
    } catch {
      blocked = true;
    }
  }
  return blocked;
}

/**
 * 先让 Chromium 自己放手：缓存目录里的索引文件由它持有，不先清掉，磁盘上的目录删不干净。
 * 三类调用与名单一一对应——HTTP 缓存、脚本缓存、CacheStorage 与着色器缓存；Cookie、Local Storage
 * 等真正属于用户的数据一律不碰。只有默认会话与校园分区两种会话。
 */
async function releaseSessions() {
  for (const partition of [undefined, CAMPUS_PARTITION]) {
    const target = partition ? session.fromPartition(partition) : session.defaultSession;
    await Promise.all([
      target.clearCache(),
      target.clearCodeCaches({}),
      target.clearStorageData({ storages: ['cachestorage', 'shadercache'] }),
    ]).catch(() => {
      // 让 Chromium 放手只是加速手段：它失败不影响下面按目录删。
    });
  }
}

/** 当前缓存占用（字节）。 */
export function cacheSize(): Promise<number> {
  return cacheBytes(app.getPath('userData'));
}

/**
 * 清缓存并复核：返回前后各量一次得到的差值。差异可能为负——清除期间 Chromium 又在写新缓存——
 * 所以夹到 0。`blocked` 只表示有文件被正在运行的进程占住，不代表用户数据没清干净。
 */
export async function clearCaches(): Promise<CacheClearResult> {
  const root = app.getPath('userData');
  const before = await cacheSize();
  await releaseSessions();
  const blocked = await removeCaches(root);
  return { freed: Math.max(0, before - (await cacheSize())), blocked };
}

export function registerCacheIpc() {
  ipcMain.handle('cache:get-size', (event) => {
    checkWorkspaceSender(event);
    return cacheSize();
  });
  ipcMain.handle('cache:clear', (event) => {
    checkWorkspaceSender(event);
    return clearCaches();
  });
}
