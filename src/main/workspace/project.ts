// 项目目录的外部操作：Git 分支查询与切换、用 VS Code 或资源管理器打开项目目录。
// 只依赖 api.ts 解析出的项目位置，不读写工作区条目。
import { app, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { remoteById } from '../remotes/api';
import { workspaceEntryIdSchema } from '../../shared/workspace';
import { projectDirectory, projectLocation, remoteProjectOf } from './api';

/** 项目目录的当前 Git 分支：非仓库、目录不存在、git 缺失与分离 HEAD 都算「没有分支」。
 *  用 symbolic-ref 而不是 rev-parse：刚 init、还没有首个提交的仓库也该显示出分支名。 */
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

/** 本地项目目录的分支；远端项目的目录在另一台机器上，不为显示一个名字去连它。 */
export function projectGitBranch(id: unknown): Promise<string | null> {
  const location = projectLocation(id);
  return location.kind === 'local' ? gitBranchOf(location.path) : Promise.resolve(null);
}

/** 本地分支名列表，按名字排序（下拉里顺序稳定）；非仓库返回空数组。 */
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

/** 失败时抛出 git 的 stderr：工作区冲突、分支不存在都要让人看到原因。 */
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

/** 远端项目的仓库在另一台机器上：切分支要经 SSH，这里直接拒绝，不做半套。 */
export function projectGitCheckout(id: unknown, branch: string): Promise<void> {
  const location = projectLocation(id);
  if (location.kind === 'remote') return Promise.reject(new Error('远程项目的分支需要在远端切换'));
  return gitCheckout(location.path, branch);
}

/** 远端项目打开失败时的补充说明：VS Code 用自己的 ssh 配置连远端，Dela 的连接记录它读不到，
 *  端口与私钥必须由用户在 ssh config 里给出来。 */
const remoteSshHint =
  '远端项目还需在 VS Code 中安装 Remote - SSH 扩展，并把该主机配置进 ssh config。';

export async function openProjectDirectory(id: unknown, target: unknown): Promise<void> {
  const action = z.enum(['vscode', 'explorer']).parse(target);
  // 远端项目的 local_path 是远端 POSIX 路径：本地既没有这个目录，也不能拿它去开本地 VS Code。
  const root = remoteProjectOf(workspaceEntryIdSchema.parse(id));
  if (root) {
    if (action !== 'vscode') throw new Error('远程项目没有本地目录');
    // 目的地取连接里登记的 host（ssh config 别名或 user@host），其余交给 VS Code 自己解析。
    return openInVsCode(root.path, `ssh-remote+${remoteById(root.remoteId).host}`);
  }
  const path = projectDirectory(id);
  if (action === 'vscode') return openInVsCode(path);
  const error = await shell.openPath(path);
  if (error) throw new Error(`无法打开项目目录：${error}`);
}
/** remoteAuthority 非空表示远端项目：本地 VS Code 收到远端 POSIX 路径只会去开本地同名目录，
 *  只有 `--remote ssh-remote+<目的地>` 会让远端那台机器的 VS Code Server 打开它。 */
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
          // Finder 启动时未必装过 code 的 PATH 链接，直接使用标准安装位置内的 CLI。
          if (!first && process.platform === 'darwin') {
            first = ['/Applications', join(app.getPath('home'), 'Applications')]
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
  // Windows CLI 是批处理脚本，改启 Code.exe；macOS CLI 可直接执行。路径都不经 shell 展开。
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
        // windowsHide 也会隐藏首次启动的 GUI 窗口，VS Code 必须可见。
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
