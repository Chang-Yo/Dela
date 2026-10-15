import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillDependency } from '../../shared/capabilities';
import requirements from './skill/requirements.lock?raw';

export const DOCUMENT_SKILL = 'document-reading';
const VERSION = '1';
const PYTHON_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip';
const PYTHON_SHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';
const UV_URL =
  'https://github.com/astral-sh/uv/releases/download/0.11.1/uv-x86_64-pc-windows-msvc.zip';
const UV_SHA256 = '6659250cebbd3bb6ee48bcb21a3f0c6656450d63fb97f0f069bcb532bdb688ed';

export function documentRuntimeDirectory(): string {
  return join(app.getPath('userData'), 'components', DOCUMENT_SKILL, VERSION);
}

export function documentPython(): string {
  return join(documentRuntimeDirectory(), 'python.exe');
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
      existsSync(join(root, 'Lib', 'site-packages', 'markitdown', '__init__.py'))
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
      join(root, 'python.exe'),
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

async function extract(zip: string, target: string, signal: AbortSignal): Promise<void> {
  await mkdir(target, { recursive: true });
  await run(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
    ['-xf', zip, '-C', target],
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
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('文档组件仅支持 Windows x64');
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    await mkdir(staging, { recursive: true });
    const pythonZip = join(staging, 'python.zip');
    const uvZip = join(staging, 'uv.zip');
    await download(PYTHON_URL, pythonZip, PYTHON_SHA256, signal);
    await extract(pythonZip, staging, signal);
    await download(UV_URL, uvZip, UV_SHA256, signal);
    await extract(uvZip, join(staging, 'installer'), signal);
    await writeFile(
      join(staging, 'python312._pth'),
      'python312.zip\n.\nLib/site-packages\nimport site\n',
    );
    const lock = join(staging, 'requirements.lock');
    await writeFile(lock, requirements);
    state = { status: 'installing', phase: '安装文档解析依赖' };
    await run(
      join(staging, 'installer', 'uv.exe'),
      [
        '--no-config',
        'pip',
        'install',
        '--python',
        join(staging, 'python.exe'),
        '--target',
        join(staging, 'Lib', 'site-packages'),
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
    await rm(pythonZip);
    await rm(uvZip);
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
