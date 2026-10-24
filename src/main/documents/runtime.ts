import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillDependency } from '../../shared/capabilities';
import requirements from './requirements.lock?raw';
import notices from './runtime-licenses.txt?raw';

export const DOCUMENT_SKILL = 'document-reading';
const VERSION = '1';
const PYTHON_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip';
const PYTHON_SHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';
const UV_URL =
  'https://github.com/astral-sh/uv/releases/download/0.11.1/uv-x86_64-pc-windows-msvc.zip';
const UV_SHA256 = '6659250cebbd3bb6ee48bcb21a3f0c6656450d63fb97f0f069bcb532bdb688ed';
const MAC_PYTHON_URL =
  'https://github.com/astral-sh/python-build-standalone/releases/download/20250529/cpython-3.12.10%2B20250529-aarch64-apple-darwin-install_only_stripped.tar.gz';
const MAC_PYTHON_SHA256 = '2579c9ffcbb0a745f1de3d645612c7466269eb9a23316a54ece49d50c1c9122f';
const MAC_UV_URL =
  'https://github.com/astral-sh/uv/releases/download/0.11.1/uv-aarch64-apple-darwin.tar.gz';
const MAC_UV_SHA256 = 'f7815f739ed5d0e4202e6292acedb8659b9ae7de663d07188d8c6cbd7f96303f';

export function documentRuntimeDirectory(): string {
  return join(app.getPath('userData'), 'components', DOCUMENT_SKILL, VERSION);
}

export function documentPython(root = documentRuntimeDirectory()): string {
  return process.platform === 'darwin'
    ? join(root, 'python', 'bin', 'python3')
    : join(root, 'python.exe');
}

function sitePackages(root: string): string {
  return process.platform === 'darwin'
    ? join(root, 'python', 'lib', 'python3.12', 'site-packages')
    : join(root, 'Lib', 'site-packages');
}

let installation: Promise<void> | undefined;
let controller: AbortController | undefined;
let state: SkillDependency = { status: 'missing' };

export function documentDependency(): SkillDependency {
  if (installation) return { ...state };
  try {
    const root = documentRuntimeDirectory();
    if (
      readFileSync(join(root, 'ready'), 'utf8') === VERSION &&
      existsSync(documentPython()) &&
      existsSync(join(sitePackages(root), 'markitdown', '__init__.py'))
    )
      return { status: 'ready' };
  } catch {
    // Only an environment that completed validation is available to skills.
  }
  return state.status === 'error' ? { ...state } : { status: 'missing' };
}

export function assertDocumentDependency(): void {
  if (documentDependency().status !== 'ready')
    throw new Error('请先在设置 › Skills 安装文档读取组件');
}

function run(
  command: string,
  args: string[],
  signal?: AbortSignal,
  env = process.env,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      signal,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let detail = '';
    child.stderr.on('data', (chunk) => {
      detail = (detail + String(chunk)).slice(-4000);
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(detail.trim() || `组件命令退出（${code}）`)),
    );
  });
}

export async function verifyDocumentRuntime(
  root = documentRuntimeDirectory(),
  signal?: AbortSignal,
): Promise<void> {
  try {
    await run(
      documentPython(root),
      [
        '-I',
        '-c',
        "from importlib.metadata import version; from markitdown import MarkItDown; import pypdfium2,openpyxl,pptx,mammoth,pdfminer; assert version('markitdown') == '0.1.8'; MarkItDown(enable_plugins=False)",
      ],
      signal,
    );
  } catch (error) {
    if (root === documentRuntimeDirectory()) {
      await rm(join(root, 'ready'), { force: true });
      state = { status: 'error', error: '文档组件检查失败，请重新安装' };
    }
    throw error;
  }
}

async function download(
  url: string,
  path: string,
  hash: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await net.fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`组件下载失败（HTTP ${response.status}）`);
  const total = Number(response.headers.get('content-length')) || undefined;
  const file = await open(path, 'wx');
  const digest = createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of response.body) {
      await file.writeFile(chunk);
      digest.update(chunk);
      received += chunk.length;
      state = { status: 'installing', phase: '下载组件', received, total };
    }
  } finally {
    await file.close();
  }
  if (digest.digest('hex') !== hash) throw new Error('组件下载校验失败，请重试');
}

async function extract(archive: string, target: string, signal: AbortSignal): Promise<void> {
  await mkdir(target, { recursive: true });
  await run(
    process.platform === 'darwin'
      ? '/usr/bin/tar'
      : join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
    ['-xf', archive, '-C', target],
    signal,
  );
}

export function cancelDocumentInstallation(): void {
  controller?.abort();
}

export function installDocumentDependency(): Promise<void> {
  if (installation) return installation;
  if (documentDependency().status === 'ready') return verifyDocumentRuntime();
  controller = new AbortController();
  const signal = controller.signal;
  state = { status: 'installing', phase: '准备组件' };
  const root = documentRuntimeDirectory();
  const staging = root;
  let completed = false;
  installation = (async () => {
    const mac = process.platform === 'darwin' && process.arch === 'arm64';
    if (!mac && !(process.platform === 'win32' && process.arch === 'x64'))
      throw new Error('文档组件仅支持 Windows x64 和 Apple Silicon Mac');
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    await mkdir(staging, { recursive: true });
    const pythonArchive = join(staging, mac ? 'python.tar.gz' : 'python.zip');
    const uvArchive = join(staging, mac ? 'uv.tar.gz' : 'uv.zip');
    await download(
      mac ? MAC_PYTHON_URL : PYTHON_URL,
      pythonArchive,
      mac ? MAC_PYTHON_SHA256 : PYTHON_SHA256,
      signal,
    );
    await extract(pythonArchive, staging, signal);
    await download(mac ? MAC_UV_URL : UV_URL, uvArchive, mac ? MAC_UV_SHA256 : UV_SHA256, signal);
    await extract(uvArchive, join(staging, 'installer'), signal);
    if (!mac)
      await writeFile(
        join(staging, 'python312._pth'),
        'python312.zip\n.\nLib/site-packages\nimport site\n',
      );
    const lock = join(staging, 'requirements.lock');
    await writeFile(lock, requirements);
    await writeFile(join(staging, 'THIRD-PARTY-NOTICES.txt'), notices);
    state = { status: 'installing', phase: '安装文档解析依赖' };
    await run(
      mac
        ? join(staging, 'installer', 'uv-aarch64-apple-darwin', 'uv')
        : join(staging, 'installer', 'uv.exe'),
      [
        '--no-config',
        'pip',
        'install',
        '--python',
        documentPython(staging),
        '--target',
        sitePackages(staging),
        '--only-binary',
        ':all:',
        '--no-deps',
        '--require-hashes',
        '--default-index',
        'https://pypi.org/simple',
        '--no-cache',
        '-r',
        lock,
      ],
      signal,
    );
    state = { status: 'installing', phase: '检查组件' };
    await verifyDocumentRuntime(staging, signal);
    signal.throwIfAborted();
    await rm(join(staging, 'installer'), { recursive: true, force: true });
    await rm(pythonArchive);
    await rm(uvArchive);
    // Publish readiness only after validation; Windows may keep imported DLLs locked briefly.
    signal.throwIfAborted();
    await writeFile(join(staging, 'ready'), VERSION);
    signal.throwIfAborted();
    completed = true;
    state = { status: 'ready' };
  })()
    .catch((error: unknown) => {
      state = signal.aborted
        ? { status: 'missing' }
        : { status: 'error', error: error instanceof Error ? error.message : '组件安装失败' };
      throw error;
    })
    .finally(async () => {
      if (!completed)
        await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
          () => {},
        );
      installation = undefined;
      controller = undefined;
    });
  return installation;
}
