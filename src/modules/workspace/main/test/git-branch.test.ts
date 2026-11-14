// 会话输入框上方的项目浮岛要显示当前 Git 分支：只有本地 Git 仓库才有分支名，
// 非仓库目录、目录不存在、分离 HEAD 都当作「没有分支」，浮岛只显示项目名。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { gitBranchesOf, gitBranchOf, gitCheckout } from '../project';

let root: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dela-branch-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('本地 Git 仓库返回当前分支', async () => {
  git('init', '-b', 'dela-test');
  await expect(gitBranchOf(root)).resolves.toBe('dela-test');
});

it('不是 Git 仓库或目录已不存在时返回 null', async () => {
  await expect(gitBranchOf(root)).resolves.toBeNull();
  await expect(gitBranchOf(join(root, 'missing'))).resolves.toBeNull();
});

/** 建一次空提交：新建分支要有提交，否则分支还处于未出生状态。 */
function commit(message = 'x'): void {
  git(
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=test',
    'commit',
    '--allow-empty',
    '-m',
    message,
  );
}

it('分离 HEAD 时没有分支名', async () => {
  git('init', '-b', 'dela-test');
  commit();
  git('checkout', '--detach');
  await expect(gitBranchOf(root)).resolves.toBeNull();
});

it('列出本地分支，按名字排序', async () => {
  git('init', '-b', 'main');
  commit();
  git('branch', 'feat/x');
  git('branch', 'fix/ui');
  await expect(gitBranchesOf(root)).resolves.toEqual(['feat/x', 'fix/ui', 'main']);
});

it('切换分支后当前分支就是新分支', async () => {
  git('init', '-b', 'main');
  commit();
  git('branch', 'feat/x');
  await gitCheckout(root, 'feat/x');
  await expect(gitBranchOf(root)).resolves.toBe('feat/x');
});

it('分支不存在时把 git 的报错抛出来，当前分支不动', async () => {
  git('init', '-b', 'main');
  commit();
  await expect(gitCheckout(root, 'nope')).rejects.toThrow(/nope/);
  await expect(gitBranchOf(root)).resolves.toBe('main');
});

it('非 Git 目录既列不出分支也切不了', async () => {
  await expect(gitBranchesOf(root)).resolves.toEqual([]);
  await expect(gitCheckout(root, 'main')).rejects.toThrow();
});
