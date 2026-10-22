/**
 * ssh 边界：只承担引导 helper（探测、上传、启动、诊断）、连接自检、隧道与终端的连接参数。
 * 远程项目的工具调用、目录树与预览都经 helper（见 helper.ts），不在这里。
 * 默认调用系统 OpenSSH（Windows 10 1809+ 自带），缺失时回退随包分发的 openssh。
 * 每条命令都是一个独立的 ssh 子进程（Windows OpenSSH 不支持 ControlMaster 多路复用）。
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
  /** 分块写 stdin 并报告已写字节（上传 helper 用）；不传就一次写完。 */
  onStdinProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
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

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
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

    if (options.stdin === undefined) child.stdin.end();
    else if (!options.onStdinProgress) child.stdin.end(options.stdin);
    else void writeChunked(child.stdin, Buffer.from(options.stdin), options.onStdinProgress);
  });
}

/** 进度粒度：64 KB 一块，等管道 drain 再写下一块，报出的字节数才是真的写进了 ssh。 */
const STDIN_CHUNK = 64 * 1024;

async function writeChunked(
  stream: NodeJS.WritableStream,
  body: Buffer,
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  for (let offset = 0; offset < body.length; offset += STDIN_CHUNK) {
    const chunk = body.subarray(offset, offset + STDIN_CHUNK);
    if (!stream.write(chunk))
      await new Promise<void>((resolve) => {
        const done = () => {
          stream.off('drain', done);
          stream.off('close', done);
          resolve();
        };
        stream.on('drain', done);
        stream.on('close', done);
      });
    onProgress(Math.min(offset + chunk.length, body.length), body.length);
  }
  stream.end();
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
