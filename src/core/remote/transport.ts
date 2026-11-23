/** ssh 边界：helper 的引导、连接自检、隧道与终端的连接参数；工具调用与目录树都经 helper.ts。
 * 默认用系统 OpenSSH，缺失时回退随包分发的；每条命令一个独立 ssh 进程（Windows OpenSSH 无 ControlMaster）。 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostPorts } from '../ports';

export interface RemoteTarget {
  host: string;
  port?: number | null;
  keyPath?: string | null;
}

/** 目标的身份：helper 通道与目录 watch 各自要判断「这是不是同一个连接」，两处必须是同一个算法。 */
export function targetKey(target: RemoteTarget): string {
  return `${target.host}|${target.port ?? ''}|${target.keyPath ?? ''}`;
}

interface ExecOptions {
  stdin?: Buffer | string;
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

const DEFAULT_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_SECONDS = 10;
/** 静默超过这么久就发一个加密保活包：中间的 NAT/防火墙会把长时间没流量的连接丢掉，
 *  实测一次 10 分钟无输出的远端命令会让会话被对端 reset，加上它就没再复现。 */
const KEEPALIVE_SECONDS = 15;
const KEEPALIVE_COUNT_MAX = 3;

// System32 里的 OpenSSH 可能是旧版（2026-10 实测 9.5p2，Program Files 为 10.0p2），
// 排障先确认实际生效的是哪一个。
function binaryCandidates(binary: 'ssh' | 'sftp'): string[] {
  if (process.platform === 'darwin') return [join('/usr/bin', binary)];
  const name = `${binary}.exe`;
  const bundledRoot = hostPorts().paths.bundled('openssh');
  return [
    join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', name),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'OpenSSH', name),
    join(bundledRoot, name),
  ];
}

const located = new Map<string, string>();

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
