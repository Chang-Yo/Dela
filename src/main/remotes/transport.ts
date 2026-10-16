/**
 * 远程传输层：Dela 的全部远程能力（内核工具、终端、目录树、@ 候选）都只经这里。
 * 默认调用系统 OpenSSH（Windows 10 1809+ 自带），缺失时回退到随包分发的 openssh 目录；
 * 两者调用方式与参数完全一致，回退只换一个可执行文件路径。
 *
 * 每条命令都是一个独立的 ssh 子进程（Windows OpenSSH 不支持 ControlMaster 多路复用），
 * 因此一次工具调用可能付多次握手；先把正确性做对，延迟优化另计。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface RemoteTarget {
  /** ssh 的第一个位置参数：`~/.ssh/config` 里的别名，或 `user@host`。 */
  host: string;
  port?: number | null;
  /** 私钥文件；留空则交给 ssh 自己按 config、agent 与 `~/.ssh/id_*` 解析。 */
  keyPath?: string | null;
}

/** 目标的身份：helper 通道与目录 watch 各自要判断「这是不是同一个连接」，两处必须是同一个算法。 */
export function targetKey(target: RemoteTarget): string {
  return `${target.host}|${target.port ?? ''}|${target.keyPath ?? ''}`;
}

interface ExecOptions {
  stdin?: Buffer | string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 流式回调（bash 工具用它把输出实时喂给 UI）。 */
  onData?: (chunk: Buffer) => void;
  /** stderr 的流式回调；bash 工具需要它，文件读取不需要（不能污染 stdout）。 */
  onStderr?: (chunk: Buffer) => void;
  /** 是否在内存里收集 stdout；流式长输出用 false，避免无上限占用。 */
  collect?: boolean;
}

interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface RemoteDirEntry {
  name: string;
  directory: boolean;
  size: number | null;
  modifiedAt: number | null;
}

interface RemoteLocation {
  /** 解析后的绝对路径（远端 POSIX 形态）。 */
  path: string;
  kind: 'directory' | 'file' | 'missing';
  /** 目录内容；不是目录时为 null。 */
  entries: RemoteDirEntry[] | null;
  /** 是否为目录（kind === 'directory' 的简写）。 */
  directory: boolean;
}

/** 单条命令的兜底超时：远端挂住时不能让调用方永久等待。 */
const DEFAULT_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_SECONDS = 10;
/** 静默超过这么久就发一个加密保活包：中间的 NAT/防火墙会把长时间没流量的连接丢掉，
 *  实测一次 10 分钟无输出的远端命令会让会话被对端 reset，加上它就没再复现。 */
const KEEPALIVE_SECONDS = 15;
const KEEPALIVE_COUNT_MAX = 3;

function binaryCandidates(binary: 'ssh' | 'sftp'): string[] {
  if (process.platform === 'darwin') return [join('/usr/bin', binary)];
  const name = `${binary}.exe`;
  const bundledRoot = app.isPackaged
    ? join(process.resourcesPath, 'openssh')
    : join(app.getAppPath(), 'vendor', 'openssh');
  return [
    join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', name),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH', name),
    join(bundledRoot, name),
  ];
}

const located = new Map<string, string>();

/** 探测顺序即回退顺序：系统路径优先，自带二进制兜底。 */
export function locateSsh(binary: 'ssh' | 'sftp' = 'ssh'): string {
  const cached = located.get(binary);
  if (cached) return cached;
  const found = binaryCandidates(binary).find((path) => existsSync(path));
  if (!found)
    throw new Error(
      process.platform === 'darwin'
        ? `未找到 macOS 系统 SSH 客户端（/usr/bin/${binary}），请检查系统环境`
        : '未找到 SSH 客户端：请在「设置 › 应用 › 可选功能」安装 OpenSSH 客户端，或把 openssh 目录放到 Dela 资源目录后重试',
    );
  located.set(binary, found);
  return found;
}

/** 单引号包裹，内部单引号用 '\'' 转义；所有进 shell 的路径与命令都过这里。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** 连接级参数：命令、终端与 helper 隧道都用同一套，避免某条路径漏掉认证或保活。 */
export function sshBaseArguments(target: RemoteTarget): string[] {
  // BatchMode：不接受任何交互式提问，认证失败就立刻报错，不把窗口挂死。
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
    '-o',
    `ServerAliveInterval=${KEEPALIVE_SECONDS}`,
    '-o',
    `ServerAliveCountMax=${KEEPALIVE_COUNT_MAX}`,
  ];
  if (target.port) args.push('-p', String(target.port));
  if (target.keyPath) args.push('-i', target.keyPath);
  return args;
}

function sshArguments(target: RemoteTarget, command: string): string[] {
  return [...sshBaseArguments(target), target.host, command];
}

export function exec(
  target: RemoteTarget,
  command: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(locateSsh(), sshArguments(target, command), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const collect = options.collect !== false;
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => child.kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (result: ExecResult) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      options.onData?.(chunk);
      if (collect) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk);
      errors.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      const stderr = Buffer.concat(errors).toString();
      if (timedOut) {
        finish({ code: 124, stdout: Buffer.concat(chunks), stderr: `命令超时未结束\n${stderr}` });
        return;
      }
      finish({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr });
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

/** 认证失败等错误在 stderr 上是英文原文；翻译成用户能动作的说明。 */
export function sshErrorMessage(result: ExecResult): string {
  const stderr = result.stderr.trim();
  if (/Host key verification failed/i.test(stderr))
    return '主机指纹未确认：请先在终端执行一次 ssh 连接，或把主机写入 known_hosts 后重试';
  if (/Permission denied|no such identity|Authentication failed/i.test(stderr))
    return '认证失败：确认公钥已加到远端 authorized_keys，或填写正确的私钥文件';
  if (/Connection timed out|Connection refused|Could not resolve hostname/i.test(stderr))
    return `无法连接远端：${stderr.split('\n')[0]}`;
  return stderr || `远端命令退出码 ${result.code}`;
}

async function run(target: RemoteTarget, command: string, options: ExecOptions = {}) {
  const result = await exec(target, command, options);
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  return result;
}

/** 连接自检：一次调用拿到系统、架构、主机名与 bash 可用性。 */
export async function probeRemote(target: RemoteTarget) {
  const result = await exec(
    target,
    `printf '%s\\n%s\\n%s\\n%s' "$(uname -s)" "$(uname -m)" "$(hostname)" "$(command -v bash || true)"`,
    { timeoutMs: 20_000 },
  );
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  const [system = '', machine = '', hostname = '', bash = ''] = result.stdout
    .toString()
    .split('\n');
  return { system, machine, hostname, bash, home: await remoteHome(target) };
}

async function remoteHome(target: RemoteTarget): Promise<string> {
  const result = await run(target, 'printf %s "$HOME"', { timeoutMs: 20_000 });
  const home = result.stdout.toString().trim();
  if (!home.startsWith('/')) throw new Error('未能解析远端主目录');
  return home;
}

/** GNU find 的 NUL 分隔清单：文件名含换行或空格也不会解析错。 */
const listCommand = (path: string) =>
  `LC_ALL=C find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%y\\0%f\\0%s\\0%T@\\0' 2>/dev/null`;

function parseListing(stdout: Buffer): RemoteDirEntry[] {
  const parts = stdout.toString('utf8').split('\0');
  const entries: RemoteDirEntry[] = [];
  for (let index = 0; index + 3 < parts.length; index += 4) {
    const name = parts[index + 1]!;
    if (!name || name === '.' || name === '..') continue;
    const size = Number(parts[index + 2]);
    const modified = Number(parts[index + 3]);
    entries.push({
      name,
      directory: parts[index] === 'd',
      size: Number.isFinite(size) ? size : null,
      modifiedAt: Number.isFinite(modified) ? modified * 1000 : null,
    });
  }
  return entries;
}

/** 非 GNU find（Alpine 等）的退化路径：只有名字与目录标记，大小与时间未知。 */
async function listFallback(target: RemoteTarget, path: string): Promise<RemoteDirEntry[]> {
  const result = await run(target, `LC_ALL=C ls -A1p ${shellQuote(path)} 2>/dev/null || true`);
  return result.stdout
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      name: line.endsWith('/') ? line.slice(0, -1) : line,
      directory: line.endsWith('/'),
      size: null,
      modifiedAt: null,
    }));
}

export async function listDirectory(target: RemoteTarget, path: string): Promise<RemoteDirEntry[]> {
  const result = await exec(target, listCommand(path), { collect: true });
  const entries = result.code === 0 ? parseListing(result.stdout) : [];
  if (result.code === 0 && (entries.length > 0 || result.stdout.length > 0)) return entries;
  return listFallback(target, path);
}

/** 一次调用同时回答「存在吗」「是目录吗」与目录内容：
 *  首行是类型标记（d/f/-），其后的 NUL 清单与 listDirectory 同格式。
 *  每次 ssh 都是一次握手（Windows 无多路复用），目录选择器全靠这一条命令翻页。 */
export async function locate(target: RemoteTarget, path: string): Promise<RemoteLocation> {
  const quoted = shellQuote(path);
  // 类型标记一律用 printf '%s\n'，别让以 - 开头的格式串被 printf 当成选项。
  const script = [
    `if [ -d ${quoted} ]; then printf '%s\\n' d; ${listCommand(path)}`,
    `elif [ -e ${quoted} ]; then printf '%s\\n' f`,
    `else printf '%s\\n' -; fi`,
  ].join('; ');
  const result = await exec(target, script, { timeoutMs: 20_000 });
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  const separator = result.stdout.indexOf(0x0a);
  if (separator < 0) throw new Error('远端返回无法解析的目录清单');
  const marker = result.stdout.subarray(0, separator).toString().trim();
  if (marker !== 'd')
    return {
      path,
      kind: marker === 'f' ? 'file' : 'missing',
      entries: null,
      directory: false,
    };
  return {
    path,
    kind: 'directory',
    entries: parseListing(result.stdout.subarray(separator + 1)),
    directory: true,
  };
}

export async function readFile(target: RemoteTarget, path: string, signal?: AbortSignal) {
  const result = await exec(target, `LC_ALL=C cat -- ${shellQuote(path)}`, { signal });
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
  return result.stdout;
}

/** 写入走「同目录临时文件 + mv」：失败不留半个文件，成功即原子替换（与本地笔记保存同款）。 */
export async function writeFile(
  target: RemoteTarget,
  path: string,
  content: Buffer | string,
): Promise<void> {
  const script = [
    'set -e',
    `d=$(dirname -- ${shellQuote(path)})`,
    'mkdir -p -- "$d"',
    'tmp="$d/.dela-write-$$"',
    'cat > "$tmp"',
    `mv -f -- "$tmp" ${shellQuote(path)}`,
  ].join('\n');
  const result = await exec(target, script, { stdin: content });
  if (result.code !== 0) throw new Error(sshErrorMessage(result));
}

export async function pathExists(target: RemoteTarget, path: string): Promise<boolean> {
  const result = await exec(target, `test -e ${shellQuote(path)}`, { timeoutMs: 20_000 });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new Error(sshErrorMessage(result));
}
