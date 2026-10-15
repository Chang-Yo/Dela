// 缓存统计与清理：只认名单里的目录名（分区里的同名目录也算），用户数据与数据库一个都不动。
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failRemove: false, root: '' }));

vi.mock('electron', () => {
  const fakeSession = () => ({
    clearCache: vi.fn(async () => {}),
    clearCodeCaches: vi.fn(async () => {}),
    clearStorageData: vi.fn(async () => {}),
  });
  return {
    app: { getPath: () => state.root },
    ipcMain: { handle: vi.fn() },
    session: { defaultSession: fakeSession(), fromPartition: vi.fn(() => fakeSession()) },
  };
});

// 删不掉是这台机器当时的状态（文件被进程占住），只有 Windows 上真的锁住文件才复现得出来。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: vi.fn(
      async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
        if (state.failRemove) throw new Error('EBUSY');
        return actual.rm(path, options);
      },
    ),
  };
});

import { session } from 'electron';
import { CAMPUS_PARTITION } from '../campus';
import { cacheSize, clearCaches } from '../cache';

function write(path: string, size: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(size));
}

beforeEach(() => {
  state.failRemove = false;
  state.root = mkdtempSync(join(tmpdir(), 'dela-cache-'));
  write(join(state.root, 'Cache', 'Cache_Data', 'a.bin'), 1000);
  write(join(state.root, 'Code Cache', 'js', 'b.js'), 2000);
  // 校园会话的分区：缓存目录在分区里面，用户的 Local Storage 也在里面，只删前者。
  write(join(state.root, 'Partitions', 'dela-campus', 'Cache', 'c.bin'), 500);
  write(join(state.root, 'Partitions', 'dela-campus', 'Local Storage', 'leveldb', 'd.lld'), 700);
  write(join(state.root, 'Local Storage', 'leveldb', 'e.lld'), 4000);
  write(join(state.root, 'misc', 'Cache'), 700);
  write(join(state.root, 'dela.db'), 8000);
});

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true });
  vi.clearAllMocks();
});

it('按目录名统计缓存占用，用户数据、数据库与同名文件都不算', async () => {
  await expect(cacheSize()).resolves.toBe(3500);
});

it('符号链接（junction）不跟，避免量到目录树外面去', async () => {
  const link = join(state.root, 'misc', 'CacheLink');
  try {
    // junction 在 Windows 上不需要管理员权限，与 pnpm 的 node_modules 同一种链接。
    symlinkSync(join(state.root, 'Cache'), link, 'junction');
  } catch {
    return; // 权限受限的环境跳过：这条只验证「不跟链接」，不是功能前提。
  }
  await expect(cacheSize()).resolves.toBe(3500);
  const result = await clearCaches();
  expect(result.freed).toBe(3500);
  // 链接指向的缓存被删了，链接本身不该被当成目录递归进去删掉别的东西。
  expect(existsSync(join(state.root, 'Local Storage', 'leveldb', 'e.lld'))).toBe(true);
});

it('清除只删缓存目录，其余文件原地不动', async () => {
  await expect(clearCaches()).resolves.toEqual({ freed: 3500, blocked: false });

  expect(await cacheSize()).toBe(0);
  expect(existsSync(join(state.root, 'Cache'))).toBe(false);
  expect(existsSync(join(state.root, 'Code Cache'))).toBe(false);
  expect(existsSync(join(state.root, 'Partitions', 'dela-campus', 'Cache'))).toBe(false);
  // 分区里真正属于用户的数据只删了缓存兄弟目录，自己还在。
  expect(existsSync(join(state.root, 'Partitions', 'dela-campus', 'Local Storage'))).toBe(true);
  expect(existsSync(join(state.root, 'Local Storage', 'leveldb', 'e.lld'))).toBe(true);
  expect(existsSync(join(state.root, 'misc', 'Cache'))).toBe(true);
  expect(statSync(join(state.root, 'dela.db')).size).toBe(8000);

  // 先让 Chromium 自己放手，磁盘上的目录才删得干净。
  expect(vi.mocked(session.defaultSession.clearCache)).toHaveBeenCalled();
  expect(vi.mocked(session.defaultSession.clearCodeCaches)).toHaveBeenCalledWith({});
  expect(vi.mocked(session.defaultSession.clearStorageData)).toHaveBeenCalledWith({
    storages: ['cachestorage', 'shadercache'],
  });
  expect(vi.mocked(session.fromPartition)).toHaveBeenCalledWith(CAMPUS_PARTITION);
});

it('有文件删不掉时如实回报 blocked', async () => {
  state.failRemove = true;
  const result = await clearCaches();
  expect(result.blocked).toBe(true);
  expect(result.freed).toBe(0);
  expect(existsSync(join(state.root, 'Cache'))).toBe(true);
});
