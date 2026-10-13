import { app } from 'electron';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

// 随应用固定版本的 MinGit（Git for Windows 官方嵌入发行版，含 bash 与 git）：
// 系统未装 Git for Windows 时，终端页可一键装到本机用户目录，无需管理员权限。
// 版本与 SHA256 必须成对更新；哈希是对发布物 zip 的校验，镜像只加速不作信任源。
export const MINGIT_VERSION = '2.56.0.2';
const MINGIT_SHA256 = 'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be';
/** 发布物 zip 的确切字节数，下载 headers 到达前用于展示进度。 */
export const MINGIT_BYTES = 39_806_486;
const MINGIT_URLS = [
  // npmmirror 逐字节镜像官方发布物（已核对 SHA256 一致），大陆 CDN 直连快，作为首选；
  // GitHub Releases 全球可达，作兜底。两源等价：下载后都过同一 SHA256 校验。
  'https://registry.npmmirror.com/-/binary/git-for-windows/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip',
  'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-2.56.0.2-64-bit.zip',
];
// 每个源连接 15 秒无响应即换下一个；响应开始后不再限时，完整下载只受用户取消控制。
const CONNECT_TIMEOUT_MS = 15_000;

export function mingitDir(): string {
  const local = process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local');
  return join(local, 'Dela', 'mingit', `v${MINGIT_VERSION}`);
}

/** MinGit 里的 bash 本体以 sh.exe 名义分发，安装时复制出 bash.exe 才走完整 bash 模式。 */
export function mingitBash(): string | null {
  const bash = join(mingitDir(), 'usr', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : null;
}

let pathPrepended = false;

/** 终端与 Agent 的 bash 都继承主进程 PATH；把 MinGit 的 cmd 目录加进去，git 才可用（幂等）。 */
export function prependMinGitPath(): void {
  if (pathPrepended || !mingitBash()) return;
  process.env.PATH = `${join(mingitDir(), 'cmd')};${process.env.PATH ?? ''}`;
  pathPrepended = true;
}

export interface MinGitInstallHooks {
  signal: AbortSignal;
  onProgress: (received: number, total: number) => void;
  onExtract: () => void;
}

let inflight: Promise<void> | null = null;

/** 已装则直接返回；并发调用复用同一次安装。失败时清理半成品目录。 */
export function installMinGit(hooks: MinGitInstallHooks): Promise<void> {
  if (mingitBash()) return Promise.resolve();
  inflight ??= run(hooks).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run({ signal, onProgress, onExtract }: MinGitInstallHooks): Promise<void> {
  const directory = mingitDir();
  try {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    const archive = join(directory, 'mingit.zip');
    await download(archive, signal, onProgress);
    onExtract();
    await extract(archive, directory, signal);
    copyFileSync(
      join(directory, 'usr', 'bin', 'sh.exe'),
      join(directory, 'usr', 'bin', 'bash.exe'),
    );
    if (!mingitBash()) throw new Error('解压结果缺少 bash');
    cleanupStaleVersions();
    prependMinGitPath();
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true });
    throw cause;
  }
}

/** 应用升级换绑新版 MinGit 后，旧版本目录成为孤儿，装新版时顺手清掉。 */
function cleanupStaleVersions(): void {
  const parent = join(mingitDir(), '..');
  for (const entry of readdirSync(parent)) {
    if (entry !== `v${MINGIT_VERSION}`)
      rmSync(join(parent, entry), { recursive: true, force: true });
  }
}

async function download(
  target: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const failures: string[] = [];
  for (const url of MINGIT_URLS) {
    try {
      await downloadOnce(url, target, signal, onProgress);
      return;
    } catch (cause) {
      if (signal.aborted) throw new Error('已取消');
      failures.push(`${new URL(url).host}：${cause instanceof Error ? cause.message : cause}`);
      rmSync(target, { force: true });
    }
  }
  throw new Error(`下载失败（${failures.join('；')}）`);
}

async function downloadOnce(
  url: string,
  target: string,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('连接超时')), CONNECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body!),
      async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          received += chunk.length;
          onProgress(received, total);
          yield chunk;
        }
      },
      createWriteStream(target),
    );
    const actual = hash.digest('hex');
    if (actual !== MINGIT_SHA256) throw new Error(`SHA256 不符（${actual.slice(0, 12)}…）`);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

/** Windows 10 1803+ 自带的 bsdtar 可直接解 zip，不引入解压依赖。 */
async function extract(archive: string, directory: string, signal: AbortSignal): Promise<void> {
  const tar = join(process.env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', directory], { signal, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`解压失败（tar 退出码 ${code}）`)),
    );
  });
}
