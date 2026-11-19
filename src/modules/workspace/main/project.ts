// 项目目录的外部操作：Git 分支查询与切换、用 VS Code 或资源管理器打开项目目录。
// 只依赖 api.ts 解析出的项目位置，不读写工作区条目。
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { remoteById } from '../../remotes';
import { workspaceEntryIdSchema } from '../contract';
import { hostPorts } from '../../../core/ports';
import { projectDirectory, projectLocation, remoteProjectOf } from './api';

/** 非仓库、目录不存在、git 缺失与分离 HEAD 都算「没有分支」；symbolic-ref 让无提交的新仓库也有分支名。 */
export async function gitBranchOf(directory: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    execFile(
      'git',
      ['symbolic-ref', '--short', 'HEAD'],
      { cwd: directory, timeout: 3000, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

/** 远端项目不为显示一个名字去连它。 */
export function projectGitBranch(id: unknown): Promise<string | null> {
  const location = projectLocation(id);
  return location.kind === 'local' ? gitBranchOf(location.path) : Promise.resolve(null);
}

export async function gitBranchesOf(directory: string): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    execFile(
      'git',
      ['branch', '--format=%(refname:short)', '--sort=refname'],
      { cwd: directory, timeout: 3000, windowsHide: true },
      (error, stdout) =>
        resolve(
          error
            ? []
            : stdout
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
        ),
    );
  });
}

/** 失败时抛出 git 的 stderr，让人看到冲突或分支不存在的原因。 */
export async function gitCheckout(directory: string, branch: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'git',
      ['checkout', branch],
      { cwd: directory, timeout: 10000, windowsHide: true },
      (error, _stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve(),
    );
  });
}

export function projectGitBranches(id: unknown): Promise<string[]> {
  const location = projectLocation(id);
  return location.kind === 'local' ? gitBranchesOf(location.path) : Promise.resolve([]);
}

export function projectGitCheckout(id: unknown, branch: string): Promise<void> {
  const location = projectLocation(id);
  if (location.kind === 'remote') return Promise.reject(new Error('远程项目的分支需要在远端切换'));
  return gitCheckout(location.path, branch);
}

/** VS Code 读不到 Dela 的连接记录，端口与私钥须由用户在 ssh config 里给出。 */
const remoteSshHint =
  '远端项目还需在 VS Code 中安装 Remote - SSH 扩展，并把该主机配置进 ssh config。';

export async function openProjectDirectory(id: unknown, target: unknown): Promise<void> {
  const action = z.enum(['vscode', 'explorer']).parse(target);
  const root = remoteProjectOf(workspaceEntryIdSchema.parse(id));
  if (root) {
    if (action !== 'vscode') throw new Error('远程项目没有本地目录');
    return openInVsCode(root.path, `ssh-remote+${remoteById(root.remoteId).host}`);
  }
  const path = projectDirectory(id);
  if (action === 'vscode') return openInVsCode(path);
  await hostPorts()
    .desktop.open(path)
    .catch((error: Error) => {
      throw new Error(`无法打开项目目录：${error.message}`);
    });
}
/** remoteAuthority 非空表示远端项目：只有 `--remote ssh-remote+<目的地>` 才会让远端打开它。 */
export async function openInVsCode(
  path: string,
  remoteAuthority: string | null = null,
): Promise<void> {
  const locate = () =>
    new Promise<string>((resolve, reject) => {
      execFile(
        process.platform === 'darwin' ? '/usr/bin/which' : 'where',
        ['code'],
        (error, stdout) => {
          let first = error ? undefined : stdout.split(/\r?\n/).find((line) => line.trim());
          if (!first && process.platform === 'darwin') {
            first = ['/Applications', join(hostPorts().paths.home(), 'Applications')]
              .map((directory) =>
                join(
                  directory,
                  'Visual Studio Code.app',
                  'Contents',
                  'Resources',
                  'app',
                  'bin',
                  'code',
                ),
              )
              .find((candidate) => existsSync(candidate));
          }
          if (!first)
            reject(
              new Error(
                remoteAuthority
                  ? `未找到 VS Code 命令（code）。${remoteSshHint}`
                  : '未找到 VS Code 命令（code）。可先安装 VS Code，或在文件夹中显示后手动打开。',
              ),
            );
          else resolve(first.trim());
        },
      );
    });
  const cli = await locate();
  const executable = process.platform === 'darwin' ? cli : join(dirname(cli), '..', 'Code.exe');
  if (!existsSync(executable))
    throw new Error(
      remoteAuthority
        ? `未找到 VS Code 程序。${remoteSshHint}`
        : '未找到 VS Code 程序，可在文件夹中显示后手动打开。',
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      remoteAuthority ? ['--remote', remoteAuthority, path] : [path],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    child.once('error', (error) => reject(new Error(`启动 VS Code 失败：${error.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
