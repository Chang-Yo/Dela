// 导出本机数据的回归：断言落在磁盘上真实存在（或不存在）什么，而不是「某个函数被调用了」。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  root: '',
  documents: '',
  home: '',
  picked: { canceled: false, filePaths: [] as string[] },
  failOn: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return state.documents;
      if (name === 'home') return state.home;
      return state.root;
    },
    getVersion: () => '1.1.0',
    isPackaged: false,
  },
  ipcMain: { handle: () => undefined },
  dialog: { showOpenDialog: async () => state.picked },
  BrowserWindow: { fromWebContents: () => null },
}));

// cp 照常工作，只对指定条目的源路径抛错，用来验证「一个条目失败不影响其余条目」。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    cp: async (
      source: Parameters<typeof actual.cp>[0],
      target: Parameters<typeof actual.cp>[1],
      options?: Parameters<typeof actual.cp>[2],
    ) => {
      if (state.failOn && String(source).includes(state.failOn)) throw new Error('EBUSY');
      return actual.cp(source, target, options);
    },
  };
});

import type { BackupResult } from '../../shared/backup';
import { exportUserData } from '../backup';
import { closeDatabase, getDatabase, SCHEMA_VERSION } from '../database';

let base: string;
let userData: string;
let pickedDirectory: string;

function exported(result: BackupResult): Extract<BackupResult, { status: 'exported' }> {
  if (result.status !== 'exported') throw new Error('这一步应当导出成功');
  return result;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dela-backup-'));
  state.documents = join(base, 'documents');
  pickedDirectory = join(base, '选定的位置');
  mkdirSync(pickedDirectory, { recursive: true });
  state.picked = { canceled: false, filePaths: [pickedDirectory] };
  state.failOn = '';

  // 一棵有代表性但很小的应用数据目录：顶层与分区里都有可再生缓存，
  // 也都有必须留下的用户数据（分区里的 Local Storage、pi 的会话正文）。
  userData = join(base, 'userData');
  state.root = userData;
  for (const cache of [
    join('Cache', 'x'),
    join('Code Cache', 'y'),
    join('Partitions', 'dela-campus', 'Code Cache', 'z'),
  ]) {
    mkdirSync(join(userData, cache), { recursive: true });
    writeFileSync(join(userData, cache, 'big.bin'), 're-generable');
  }
  mkdirSync(join(userData, 'Partitions', 'dela-campus', 'Local Storage', 'leveldb'), {
    recursive: true,
  });
  writeFileSync(
    join(userData, 'Partitions', 'dela-campus', 'Local Storage', 'leveldb', 'w.ldb'),
    'keep',
  );
  mkdirSync(join(userData, 'pi', 'sessions'), { recursive: true });
  writeFileSync(join(userData, 'pi', 'sessions', 'a.jsonl'), 'keep');
  mkdirSync(join(state.documents, 'Dela'), { recursive: true });
  writeFileSync(join(state.documents, 'Dela', 'note.txt'), 'keep');
  // 用户自己写的 Skill 在 ~/.dela/skills，不在应用数据目录里，得单独带走。
  state.home = join(base, 'home');
  mkdirSync(join(state.home, '.dela', 'skills', 'mine'), { recursive: true });
  writeFileSync(join(state.home, '.dela', 'skills', 'mine', 'SKILL.md'), 'keep');
});

afterEach(() => {
  closeDatabase();
  rmSync(base, { recursive: true, force: true });
});

it('跳过可再生缓存、保留用户数据，并给数据库取一致快照', async () => {
  getDatabase()
    .prepare(
      `INSERT INTO consent_records (document, revision, app_version, accepted_at)
       VALUES ('terms', '2026-10-15', '1.1.0', '2026-10-15T09:00:00.000Z')`,
    )
    .run();
  // 前提：写入后 WAL 真的落在磁盘上，否则下面「快照不带 -wal」是白测的。
  expect(existsSync(join(userData, 'dela.db-wal'))).toBe(true);

  const result = exported(await exportUserData(null));
  // 文件夹名不能带 Windows 非法字符（时间用 - 而不是 :）。
  expect(result.path).toMatch(/Dela 备份 \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/);
  expect(result.skipped).toEqual([]);
  const data = join(result.path, '应用数据');

  for (const cache of ['Cache', 'Code Cache', join('Partitions', 'dela-campus', 'Code Cache')])
    expect(existsSync(join(data, cache))).toBe(false);
  expect(
    existsSync(join(data, 'Partitions', 'dela-campus', 'Local Storage', 'leveldb', 'w.ldb')),
  ).toBe(true);
  expect(existsSync(join(data, 'pi', 'sessions', 'a.jsonl'))).toBe(true);
  expect(existsSync(join(result.path, '工作目录', 'note.txt'))).toBe(true);
  expect(existsSync(join(result.path, '技能', 'mine', 'SKILL.md'))).toBe(true);

  expect(existsSync(join(data, 'dela.db-wal'))).toBe(false);
  expect(existsSync(join(data, 'dela.db-shm'))).toBe(false);
  const snapshot = new Database(join(data, 'dela.db'), { readonly: true });
  try {
    expect(snapshot.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(snapshot.prepare('SELECT COUNT(*) AS count FROM consent_records').get()).toEqual({
      count: 1,
    });
  } finally {
    snapshot.close();
  }
});

it('用户取消时不生成任何东西', async () => {
  state.picked = { canceled: true, filePaths: [] };

  expect(await exportUserData(null)).toEqual({ status: 'cancelled' });
  expect(readdirSync(pickedDirectory)).toEqual([]);
});

it('同一分钟重复导出不覆盖已有备份', async () => {
  const first = exported(await exportUserData(null));
  const second = exported(await exportUserData(null));

  expect(second.path).not.toBe(first.path);
  expect(existsSync(join(first.path, '应用数据', 'dela.db'))).toBe(true);
  expect(existsSync(join(second.path, '应用数据', 'dela.db'))).toBe(true);
});

it('目标落在数据目录里面时直接拒绝，不在源目录里建备份文件夹', async () => {
  // 导出的源就是这个目录，写进它自己会让复制边写边读自己。
  state.picked = { canceled: false, filePaths: [userData] };

  const result = await exportUserData(null);

  expect(result).toMatchObject({ status: 'failed', reason: expect.stringContaining('数据目录') });
  // 读工作目录设置本身要开库（dela.db 因此出现在 userData 里），但导出不该往里写备份。
  expect(readdirSync(userData).filter((name) => name.startsWith('Dela 备份'))).toEqual([]);
});

it('单个条目复制失败不影响其余条目，名字如实回报', async () => {
  state.failOn = 'Partitions';

  const result = exported(await exportUserData(null));

  expect(result.skipped).toEqual(['Partitions']);
  expect(existsSync(join(result.path, '应用数据', 'pi', 'sessions', 'a.jsonl'))).toBe(true);
  expect(existsSync(join(result.path, '应用数据', 'dela.db'))).toBe(true);
  expect(existsSync(join(result.path, '应用数据', 'Partitions'))).toBe(false);
});
