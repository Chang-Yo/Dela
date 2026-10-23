// Pi packages 的 npm：用户开启包能力时先用本机 npm，没有再下载一份 Dela 专用的 Node 发行版
// （自带 npm）。Pi 的 DefaultPackageManager 经 settings.npmCommand 调用它，按命令名识别 npm 并带上
// --legacy-peer-deps，所以这里给的必须是 npm 本身（npm.cmd / bin/npm），不能是 node + npm-cli.js。
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NpmRuntimeState } from '../../shared/packages';

// 与开发环境固定的 Node 同一 LTS；版本与各平台 SHA256 必须成对更新。
export const NODE_VERSION = '24.22.1';
const NODE_DIST: Record<string, { file: string; sha256: string }> = {
  'win32-x64': {
    file: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5',
  },
  'win32-arm64': {
    file: `node-v${NODE_VERSION}-win-arm64.zip`,
    sha256: 'a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171',
  },
  'darwin-arm64': {
    file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7',
  },
  'darwin-x64': {
    file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035',
  },
};
// npmmirror 逐字节镜像 nodejs.org 的发布物，大陆实测约快一倍，作首选；官方源兜底。
// 两源等价：下载后过同一 SHA256，镜像只加速不作信任源。
const NODE_MIRRORS = ['https://registry.npmmirror.com/-/binary/node', 'https://nodejs.org/dist'];
// 每个源连接 15 秒无响应即换下一个；响应开始后不再限时，只受用户取消控制。
const CONNECT_TIMEOUT_MS = 15_000;
// Pi 的扩展加载与 npm 11 都要求 Node 20+；更老的系统 Node 当作没有。
const MIN_NODE_MAJOR = 20;

export interface NpmRuntime {
  /** 交给 Pi settings.npmCommand 的命令。 */
  command: string[];
  version: string;
  origin: 'system' | 'bundled';
}

function runtimeRoot(): string {
  return join(app.getPath('userData'), 'components', 'node');
}

function bundledDirectory(): string {
  return join(runtimeRoot(), `v${NODE_VERSION}`);
}

/** 解压后 zip/tar 顶层是 node-v<ver>-<platform>-<arch>/。 */
function bundledNodeHome(): string | null {
  const directory = bundledDirectory();
  if (!existsSync(join(directory, 'ready'))) return null;
  const home = readdirSync(directory).find((entry) => entry.startsWith('node-v'));
  return home ? join(directory, home) : null;
}

function bundledNpm(home: string): string {
  return process.platform === 'win32' ? join(home, 'npm.cmd') : join(home, 'bin', 'npm');
}

/**
 * 只捕获 stdout 的一次短命令。Windows 上 npm 是 .cmd，必须经 shell 执行；参数只有固定的
 * --version，路径加引号后拼成一条命令（Node 不再接受 shell 模式下单独传参数）。
 */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn(
      windows ? [`"${command}"`, ...args].join(' ') : command,
      windows ? [] : args,
      {
        shell: windows,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let out = '';
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

/** 本机 PATH 上的 npm，且它所用的 Node 不低于 MIN_NODE_MAJOR。 */
async function systemNpm(): Promise<NpmRuntime | null> {
  try {
    const [npmVersion, nodeVersion] = await Promise.all([
      capture('npm', ['--version']),
      capture('node', ['--version']),
    ]);
    const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1]);
    if (!npmVersion || !Number.isFinite(major) || major < MIN_NODE_MAJOR) return null;
    return { command: ['npm'], version: npmVersion, origin: 'system' };
  } catch {
    return null;
  }
}

/** Dela 下载的 Node 里的 npm：把它的目录前插到 PATH，npm 脚本里的 `node` 才找得到同一个。 */
async function bundledNpmRuntime(): Promise<NpmRuntime | null> {
  const home = bundledNodeHome();
  if (!home) return null;
  const npm = bundledNpm(home);
  if (!existsSync(npm)) return null;
  prependNodePath(home);
  try {
    return { command: [npm], version: await capture(npm, ['--version']), origin: 'bundled' };
  } catch {
    return null;
  }
}

let prepended: string | null = null;
function prependNodePath(home: string) {
  if (prepended === home) return;
  const bin = process.platform === 'win32' ? home : join(home, 'bin');
  const separator = process.platform === 'win32' ? ';' : ':';
  process.env.PATH = `${bin}${separator}${process.env.PATH ?? ''}`;
  prepended = home;
}

/** 已下载的优先：用户机器上的 npm 可能被卸载或换版本，自带的那份不会变。 */
export async function locateNpm(): Promise<NpmRuntime | null> {
  return (await bundledNpmRuntime()) ?? (await systemNpm());
}

let state: NpmRuntimeState = { status: 'disabled' };
let inflight: Promise<NpmRuntime> | null = null;
let controller: AbortController | null = null;

export function npmRuntimeState(): NpmRuntimeState {
  return state;
}

export function cancelNodeInstall(): void {
  controller?.abort();
}

/**
 * 开启包能力时调用：本机有 npm 就用，没有就下载。并发调用复用同一次；
 * onState 每次状态变化回调（下载进度节流由调用方处理）。
 */
export function ensureNpmRuntime(onState: (state: NpmRuntimeState) => void): Promise<NpmRuntime> {
  const update = (next: NpmRuntimeState) => {
    state = next;
    onState(next);
  };
  inflight ??= (async () => {
    update({ status: 'checking' });
    const found = await locateNpm();
    if (found) return found;
    controller = new AbortController();
    await installNode(controller.signal, update);
    const installed = await bundledNpmRuntime();
    if (!installed) throw new Error('Node 运行时安装后无法执行 npm');
    return installed;
  })()
    .then((runtime) => {
      update({
        status: 'ready',
        npm: runtime.command.join(' '),
        version: runtime.version,
        origin: runtime.origin,
      });
      return runtime;
    })
    .catch((error: unknown) => {
      update(
        controller?.signal.aborted
          ? { status: 'disabled' }
          : { status: 'error', error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    })
    .finally(() => {
      inflight = null;
      controller = null;
    });
  return inflight;
}

/** 启动时恢复状态：开关已开的话只做定位，不触发下载。 */
export async function restoreNpmRuntime(): Promise<NpmRuntime | null> {
  const runtime = await locateNpm();
  state = runtime
    ? {
        status: 'ready',
        npm: runtime.command.join(' '),
        version: runtime.version,
        origin: runtime.origin,
      }
    : { status: 'error', error: '找不到 npm，请重新开启以下载 Node 运行时' };
  return runtime;
}

export function resetNpmRuntimeState(): void {
  state = { status: 'disabled' };
}

async function installNode(
  signal: AbortSignal,
  update: (state: NpmRuntimeState) => void,
): Promise<void> {
  const dist = NODE_DIST[`${process.platform}-${process.arch}`];
  if (!dist) throw new Error(`暂不支持为 ${process.platform}-${process.arch} 下载 Node`);
  const directory = bundledDirectory();
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  try {
    const archive = join(directory, dist.file);
    await download(dist, archive, signal, (received, total) =>
      update({ status: 'installing', phase: '下载 Node 运行时', received, total }),
    );
    update({ status: 'installing', phase: '解压 Node 运行时' });
    await extract(archive, directory, signal);
    rmSync(archive, { force: true });
    const home = readdirSync(directory).find((entry) => entry.startsWith('node-v'));
    if (!home || !existsSync(bundledNpm(join(directory, home))))
      throw new Error('解压结果缺少 npm');
    writeFileSync(join(directory, 'ready'), NODE_VERSION);
    for (const entry of readdirSync(runtimeRoot()))
      if (entry !== `v${NODE_VERSION}`)
        rmSync(join(runtimeRoot(), entry), { recursive: true, force: true });
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true });
    throw cause;
  }
}

async function download(
  dist: { file: string; sha256: string },
  target: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const failures: string[] = [];
  for (const base of NODE_MIRRORS) {
    const url = `${base}/v${NODE_VERSION}/${dist.file}`;
    try {
      await downloadOnce(url, dist.sha256, target, signal, onProgress);
      return;
    } catch (cause) {
      if (signal.aborted) throw new Error('已取消');
      failures.push(`${new URL(url).host}：${cause instanceof Error ? cause.message : cause}`);
      rmSync(target, { force: true });
    }
  }
  throw new Error(`Node 运行时下载失败（${failures.join('；')}）`);
}

async function downloadOnce(
  url: string,
  sha256: string,
  target: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => local.abort(new Error('连接超时')), CONNECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: local.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      async function* (chunks) {
        for await (const chunk of chunks as AsyncIterable<Buffer>) {
          hash.update(chunk);
          received += chunk.length;
          onProgress(received, total);
          yield chunk;
        }
      },
      createWriteStream(target),
    );
    const actual = hash.digest('hex');
    if (actual !== sha256) throw new Error(`SHA256 不符（${actual.slice(0, 12)}…）`);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

/** Windows 10 1803+ 与 macOS 自带的 bsdtar 都能解 zip 与 tar.gz，不引入解压依赖。 */
function extract(archive: string, directory: string, signal: AbortSignal): Promise<void> {
  const tar =
    process.platform === 'win32'
      ? join(process.env.windir ?? 'C:\\Windows', 'System32', 'tar.exe')
      : '/usr/bin/tar';
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', directory], { signal, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`解压失败（tar 退出码 ${code}）`)),
    );
  });
}
