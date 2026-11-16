import { app, session } from 'electron';
import { lstat, readdir, rm } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { CacheClearResult } from '../contract';

/**
 * Chromium 可再生缓存目录名单，按名字在每一层认，分区里的用户数据不动；`backup.ts` 导出时跳过同一份
 * 名单，两处必须同源。Crashpad 与 logs 同样只对本机有意义，一并算进来。
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

function isCacheDirectory(path: string): boolean {
  if (cacheDirectoryNames.has(basename(path))) return true;
  const localPath = relative(app.getPath('userData'), path).replaceAll('\\', '/');
  return /^shuiyuan-snapshots\/\d+(?:\.partial)?\/thumbnails$/.test(localPath);
}

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

async function cacheBytes(directory: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      total += isCacheDirectory(path) ? await treeBytes(path) : await cacheBytes(path);
    } catch {
      // 读不到的目录跳过。
    }
  }
  return total;
}

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
      if (isCacheDirectory(path)) await rm(path, { recursive: true, force: true });
      else blocked = (await removeCaches(path)) || blocked;
    } catch {
      blocked = true;
    }
  }
  return blocked;
}

/**
 * 先让 Chromium 放手：缓存索引文件由它持有，不先清掉目录删不干净。Cookie、Local Storage
 * 等用户数据不碰；持久分区（如校园登录）按 Partitions 目录逐个认。
 */
async function releaseSessions() {
  const partitions = await readdir(join(app.getPath('userData'), 'Partitions')).catch(() => []);
  for (const partition of [undefined, ...partitions.map((name) => `persist:${name}`)]) {
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

export function cacheSize(): Promise<number> {
  return cacheBytes(app.getPath('userData'));
}

/**
 * 清缓存并复核：返回前后各量一次的差值，清除期间 Chromium 可能又写入，故夹到 0。
 * `blocked` 只表示有文件被运行中的进程占住。
 */
export async function clearCaches(): Promise<CacheClearResult> {
  const root = app.getPath('userData');
  const before = await cacheSize();
  await releaseSessions();
  const blocked = await removeCaches(root);
  return { freed: Math.max(0, before - (await cacheSize())), blocked };
}
