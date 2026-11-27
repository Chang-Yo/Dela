import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { diffStatOf } from '../../protocol/diff';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 逐个 spawn git 并比对真实文件，慢机器上超过默认 5s，整文件放宽到 30s。
vi.setConfig({ testTimeout: 30_000 });

const profile = vi.hoisted(() => ({ path: '' }));
vi.mock('electron', () => ({ app: { getPath: () => profile.path } }));
vi.mock('node:fs/promises', { spy: true });

import { provideTestHostPorts } from '../../test/host-mock';
import {
  captureDirectory,
  deleteTurnChanges,
  freezeTurnChanges,
  listTurnChanges,
  readTurnChanges,
  readTurnFileChange,
  readUncommittedChanges,
  readUncommittedFileChange,
} from '../changes';

let root: string;
let cwd: string;
let sessionId: string;

beforeEach(async () => {
  root = await fsPromises.realpath(mkdtempSync(join(tmpdir(), 'dela-changes-')));
  cwd = join(root, 'project');
  profile.path = join(root, 'profile');
  provideTestHostPorts({ paths: { userData: () => profile.path } });
  mkdirSync(cwd);
  sessionId = randomUUID();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function git(...args: string[]) {
  return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
}
function init() {
  git('init', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
}
function commit() {
  git('add', '.');
  git('-c', 'user.name=Dela Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline');
}

it('非 Git 目录记录脚本的增改删，排除依赖与 ignore 路径，冻结后不读取当前文件', async () => {
  writeFileSync(join(cwd, 'a.txt'), '用户原有修改\n');
  writeFileSync(join(cwd, 'deleted.txt'), 'remove\n');
  writeFileSync(join(cwd, '.gitignore'), 'private/\n');
  for (const folder of ['private', 'node_modules', 'dist']) {
    mkdirSync(join(cwd, folder));
    writeFileSync(join(cwd, folder, 'ignored.txt'), 'before');
  }
  const before = await captureDirectory(cwd);
  expect(Object.keys(before.files).sort()).toEqual(['.gitignore', 'a.txt', 'deleted.txt']);
  execFileSync(
    process.execPath,
    [
      '-e',
      "const f=require('node:fs');f.writeFileSync('a.txt','本轮结果\\n');f.writeFileSync('new.txt','new\\n');f.unlinkSync('deleted.txt');f.writeFileSync('node_modules/ignored.txt','after');",
    ],
    { cwd, windowsHide: true },
  );
  const turn = randomUUID();
  await freezeTurnChanges(sessionId, turn, cwd, '2026-10-19T00:00:00.000Z', 'completed', before);
  expect(
    (await readTurnChanges(sessionId, turn))?.files.map(({ path, status }) => ({ path, status })),
  ).toEqual([
    { path: 'a.txt', status: 'modified' },
    { path: 'deleted.txt', status: 'deleted' },
    { path: 'new.txt', status: 'added' },
  ]);
  writeFileSync(join(cwd, 'a.txt'), '下一轮或用户后来的改动\n');
  rmSync(join(cwd, 'new.txt'));
  const detail = await readTurnFileChange(sessionId, turn, 'a.txt');
  expect(detail.before).toBe('用户原有修改\n');
  expect(detail.after).toBe('本轮结果\n');
  expect(detail.patch).toContain('-用户原有修改');
  expect(detail.patch).not.toContain('下一轮');
  expect((await readTurnFileChange(sessionId, turn, 'new.txt')).after).toBe('new\n');
  await expect(readTurnFileChange(sessionId, turn, '../outside')).rejects.toThrow('没有此文件');
  await expect(readUncommittedChanges(cwd)).resolves.toMatchObject({
    available: false,
    reason: 'not-git',
    files: [],
  });
});

it('连续两轮的基准独立，停止与失败轮次也保留已发生的变化', async () => {
  writeFileSync(join(cwd, 'a.txt'), 'A');
  const firstBefore = await captureDirectory(cwd);
  writeFileSync(join(cwd, 'a.txt'), 'B');
  const first = randomUUID();
  await freezeTurnChanges(
    sessionId,
    first,
    cwd,
    '2026-10-19T00:00:00.000Z',
    'stopped',
    firstBefore,
  );
  const secondBefore = await captureDirectory(cwd);
  writeFileSync(join(cwd, 'a.txt'), 'C');
  const second = randomUUID();
  await freezeTurnChanges(
    sessionId,
    second,
    cwd,
    '2026-10-19T00:01:00.000Z',
    'failed',
    secondBefore,
  );
  expect(await readTurnFileChange(sessionId, first, 'a.txt')).toMatchObject({
    before: 'A',
    after: 'B',
  });
  expect(await readTurnFileChange(sessionId, second, 'a.txt')).toMatchObject({
    before: 'B',
    after: 'C',
  });
  expect((await listTurnChanges(sessionId)).map((turn) => turn.runStatus)).toEqual([
    'failed',
    'stopped',
  ]);
  await deleteTurnChanges(sessionId);
  expect(await listTurnChanges(sessionId)).toEqual([]);
  expect(await readTurnChanges(sessionId, first)).toBeNull();
});

it('轮末新增 ignore 规则不把仍存在的文件误报为删除', async () => {
  writeFileSync(join(cwd, 'a.txt'), 'same');
  const before = await captureDirectory(cwd);
  writeFileSync(join(cwd, '.gitignore'), 'a.txt\n');
  const turn = randomUUID();
  await freezeTurnChanges(sessionId, turn, cwd, new Date().toISOString(), 'completed', before);
  expect((await readTurnChanges(sessionId, turn))?.files.map((file) => file.path)).toEqual([
    '.gitignore',
  ]);
});

it('Git 当前变更合并已暂存、未暂存、删除与未跟踪文件，不修改真实索引', async () => {
  init();
  for (const name of ['staged.txt', 'working.txt', 'deleted.txt'])
    writeFileSync(join(cwd, name), 'HEAD\n');
  writeFileSync(join(cwd, '.gitignore'), 'ignored.txt\n');
  commit();
  writeFileSync(join(cwd, 'staged.txt'), 'INDEX\n');
  git('add', 'staged.txt');
  writeFileSync(join(cwd, 'staged.txt'), 'WORKTREE\n');
  writeFileSync(join(cwd, 'working.txt'), 'working\n');
  rmSync(join(cwd, 'deleted.txt'));
  writeFileSync(join(cwd, '新文件.txt'), 'new\n');
  writeFileSync(join(cwd, 'ignored.txt'), 'ignored\n');
  const statusBefore = git('status', '--porcelain=v1');
  const changes = await readUncommittedChanges(cwd);
  expect(changes).toMatchObject({ available: true, reason: null });
  expect(changes.files.map((file) => file.path)).toEqual([
    'deleted.txt',
    'staged.txt',
    'working.txt',
    '新文件.txt',
  ]);
  expect(await readUncommittedFileChange(cwd, 'staged.txt')).toMatchObject({
    before: 'HEAD\n',
    after: 'WORKTREE\n',
  });
  expect(await readUncommittedFileChange(cwd, 'deleted.txt')).toMatchObject({
    status: 'deleted',
    before: 'HEAD\n',
    after: null,
  });
  expect(git('status', '--porcelain=v1')).toBe(statusBefore);
  expect(git('show', ':staged.txt')).toBe('INDEX\n');
});

it('仓库子目录只返回会话目录中的变更', async () => {
  init();
  mkdirSync(join(cwd, 'sub'));
  writeFileSync(join(cwd, 'outside.txt'), 'outside');
  writeFileSync(join(cwd, 'sub', 'a.txt'), 'A');
  commit();
  writeFileSync(join(cwd, 'outside.txt'), 'changed');
  writeFileSync(join(cwd, 'sub', 'a.txt'), 'B');
  const sub = join(cwd, 'sub');
  expect((await readUncommittedChanges(sub)).files.map((file) => file.path)).toEqual(['a.txt']);
  expect(await readUncommittedFileChange(sub, 'a.txt')).toMatchObject({ before: 'A', after: 'B' });
});

it('单文件详情只读取目标文件，路径中的通配字符按字面匹配', async () => {
  init();
  for (const name of ['[a].txt', 'a.txt']) writeFileSync(join(cwd, name), 'HEAD');
  commit();
  for (const name of ['[a].txt', 'a.txt']) writeFileSync(join(cwd, name), 'changed');
  const read = vi.mocked(fsPromises.readFile);
  read.mockClear();
  expect(await readUncommittedFileChange(cwd, '[a].txt')).toMatchObject({
    path: '[a].txt',
    before: 'HEAD',
    after: 'changed',
  });
  const actualPaths = await Promise.all(
    read.mock.calls.map(([path]) => fsPromises.realpath(String(path))),
  );
  expect(actualPaths).toEqual([await fsPromises.realpath(join(cwd, '[a].txt'))]);
  await expect(readUncommittedFileChange(cwd, '../outside.txt')).rejects.toThrow('工作目录');
  await expect(readUncommittedFileChange(cwd, 'missing.txt')).rejects.toThrow('没有未提交改动');
});

it.each(['autocrlf', 'attributes'])('工作区 diff 遵循 Git 换行转换：%s', async (mode) => {
  init();
  if (mode === 'autocrlf') git('config', 'core.autocrlf', 'true');
  else writeFileSync(join(cwd, '.gitattributes'), '*.txt text eol=crlf\n');
  writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\nthree\n');
  commit();
  writeFileSync(join(cwd, 'a.txt'), 'one\r\nchanged\r\nthree\r\n');
  const status = git('status', '--porcelain=v1');
  const result = await readUncommittedFileChange(cwd, 'a.txt');
  expect(diffStatOf(result.patch)).toEqual({ added: 1, deleted: 1 });
  expect(result.after).toContain('\r\n');
  expect(git('status', '--porcelain=v1')).toBe(status);
});
