import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 随包 MinGit：打包产物在 resources/mingit，开发模式对应 prepare-runtime.ts 的产出。 */
function bundledDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'mingit');
  return join(app.getAppPath(), '.build', 'mingit');
}

export function bundledBash(): string | null {
  if (process.platform !== 'win32') return null;
  const bash = join(bundledDir(), 'usr', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : null;
}

function systemBash(): string | null {
  if (process.platform === 'darwin') return existsSync('/bin/bash') ? '/bin/bash' : null;
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** macOS 使用系统 Bash；Windows 先用系统安装的 Git for Windows，再用随包 MinGit。
 *  不回退 PATH 上的 bash（可能是 WSL）；都缺失说明安装包被破坏，交给用户自行修复。 */
export function locateBash(): string {
  if (process.platform === 'darwin') {
    const bash = systemBash();
    if (!bash) throw new Error('未找到 macOS 系统 Bash（/bin/bash），请检查系统环境');
    return bash;
  }
  const bash = systemBash() ?? bundledBash();
  if (!bash)
    throw new Error(
      '未找到 Git Bash：请安装 Git for Windows（https://git-scm.com/download/win）后重启 Dela',
    );
  return bash;
}

/** 随包搜索工具（rg/fd）：内核 grep/find 直接 spawn 它们，缺失时 pi 会从
 *  GitHub 直连下载（大陆大概率失败），所以随安装包分发并前插 PATH。 */
function searchToolsDir(): string | null {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'vendor', 'bin');
  const dir = process.platform === 'darwin' ? join(root, `darwin-${process.arch}`) : root;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return ['rg', 'fd'].every((name) => existsSync(join(dir, `${name}${suffix}`))) ? dir : null;
}

/** 终端与 Agent 都继承主进程 PATH：启动时前插随包 MinGit 的 cmd 目录（git）与搜索工具目录。 */
export function prependRuntimePath(): void {
  // Finder 启动时 PATH 可能只有系统目录；保留已有顺序，补齐系统工具及常用 Homebrew 位置。
  if (process.platform === 'darwin') {
    const paths = (process.env.PATH ?? '').split(':').filter(Boolean);
    for (const path of [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]) {
      if (!paths.includes(path)) paths.push(path);
    }
    process.env.PATH = paths.join(':');
  }
  if (bundledBash()) process.env.PATH = `${join(bundledDir(), 'cmd')};${process.env.PATH ?? ''}`;
  const tools = searchToolsDir();
  if (tools)
    process.env.PATH = `${tools}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
}
