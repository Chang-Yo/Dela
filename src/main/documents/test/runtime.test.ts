import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  profile: '',
  fetch: vi.fn(),
  spawn: vi.fn(),
  digests: [] as string[],
}));
vi.mock('electron', () => ({ app: { getPath: () => mocks.profile }, net: { fetch: mocks.fetch } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:crypto', () => ({
  createHash: () => ({ update() {}, digest: () => mocks.digests.shift() }),
}));

const platforms = [
  {
    platform: 'darwin',
    arch: 'arm64',
    python: ['python', 'bin', 'python3'],
    packages: ['python', 'lib', 'python3.12', 'site-packages'],
    hashes: [
      '2579c9ffcbb0a745f1de3d645612c7466269eb9a23316a54ece49d50c1c9122f',
      'f7815f739ed5d0e4202e6292acedb8659b9ae7de663d07188d8c6cbd7f96303f',
    ],
  },
  {
    platform: 'win32',
    arch: 'x64',
    python: ['python.exe'],
    packages: ['Lib', 'site-packages'],
    hashes: [
      '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3',
      '6659250cebbd3bb6ee48bcb21a3f0c6656450d63fb97f0f069bcb532bdb688ed',
    ],
  },
];
let runtime: typeof import('../runtime');
let root: string;
let failVerification = false;
let cancelInstall = false;

function fixture(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'fixture');
}

async function setup(platform = platforms[0]!) {
  vi.stubGlobal('process', { ...process, platform: platform.platform, arch: platform.arch });
  mocks.digests = [...platform.hashes];
  runtime = await import('../runtime');
  root = runtime.documentRuntimeDirectory();
  mocks.spawn.mockImplementation(
    (command: string, args: string[], options: { signal?: AbortSignal }) => {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      queueMicrotask(() => {
        if (args[0] === '-xf' && args[1]!.includes('python.')) fixture(runtime.documentPython());
        if (args.includes('install')) {
          fixture(join(root, ...platform.packages, 'markitdown', '__init__.py'));
          if (cancelInstall) runtime.cancelDocumentInstallation();
        }
        if (options.signal?.aborted) {
          child.emit('error', new Error('aborted'));
        } else if (command === runtime.documentPython() && failVerification) {
          child.stderr.emit('data', 'broken native library');
          child.emit('close', 1);
        } else {
          if (
            command === runtime.documentPython() &&
            runtime.documentDependency().status === 'installing'
          )
            expect(existsSync(join(root, 'ready'))).toBe(false);
          child.emit('close', 0);
        }
      });
      return child;
    },
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.profile = mkdtempSync(join(tmpdir(), 'dela-document-runtime-中文 '));
  mocks.fetch.mockImplementation(async () => new Response('archive fixture'));
  failVerification = false;
  cancelInstall = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(mocks.profile, { recursive: true, force: true });
});

it.each(platforms)(
  '$platform installs and verifies before publishing readiness',
  async (platform) => {
    await setup(platform);
    expect(runtime.documentDependency().status).toBe('missing');
    const first = runtime.installDocumentDependency();
    expect(runtime.installDocumentDependency()).toBe(first);
    await first;
    expect(runtime.documentPython()).toBe(join(root, ...platform.python));
    expect(runtime.documentDependency()).toEqual({ status: 'ready' });
    expect(readFileSync(join(root, 'ready'), 'utf8')).toBe('1');
    expect(readFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toContain('MarkItDown');
    const install = mocks.spawn.mock.calls.find(([, args]) => args.includes('install'))!;
    expect(install[1]).toEqual(
      expect.arrayContaining([
        '--python',
        runtime.documentPython(),
        '--target',
        join(root, ...platform.packages),
        '--require-hashes',
        '--only-binary',
        ':all:',
        '--no-deps',
        '--no-config',
      ]),
    );
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(
      platform.platform === 'darwin'
        ? [
            expect.stringContaining('aarch64-apple-darwin-install_only_stripped.tar.gz'),
            expect.stringContaining('uv-aarch64-apple-darwin.tar.gz'),
          ]
        : [
            expect.stringContaining('embed-amd64.zip'),
            expect.stringContaining('uv-x86_64-pc-windows-msvc.zip'),
          ],
    );
    if (platform.platform === 'darwin') {
      expect(mocks.spawn.mock.calls[0]![0]).toBe('/usr/bin/tar');
      expect(install[0]).toBe(join(root, 'installer', 'uv-aarch64-apple-darwin', 'uv'));
      expect(existsSync(join(root, 'python312._pth'))).toBe(false);
    } else {
      expect(mocks.spawn.mock.calls[0]![0]).toMatch(/System32[/\\]tar\.exe$/);
      expect(install[0]).toBe(join(root, 'installer', 'uv.exe'));
      expect(readFileSync(join(root, 'python312._pth'), 'utf8')).toContain('Lib/site-packages');
    }
    for (const name of ['installer', 'python.zip', 'uv.zip', 'python.tar.gz', 'uv.tar.gz'])
      expect(existsSync(join(root, name))).toBe(false);
    await runtime.installDocumentDependency();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  },
);

it('rejects a marker with missing interpreter or packages', async () => {
  await setup();
  fixture(join(root, 'ready'));
  writeFileSync(join(root, 'ready'), '1');
  expect(runtime.documentDependency().status).toBe('missing');
  fixture(runtime.documentPython());
  expect(runtime.documentDependency().status).toBe('missing');
});

it.each([0, 1])(
  'rejects archive %i checksum failure, cleans partial files and allows retry',
  async (index) => {
    await setup();
    mocks.digests[index] = 'wrong hash';
    await expect(runtime.installDocumentDependency()).rejects.toThrow('校验失败');
    expect(existsSync(root)).toBe(false);
    expect(runtime.documentDependency().status).toBe('error');
    mocks.digests = [...platforms[0]!.hashes];
    await runtime.installDocumentDependency();
    expect(runtime.documentDependency().status).toBe('ready');
  },
);

it('cancels the package process and removes partial installation before retry', async () => {
  await setup();
  cancelInstall = true;
  await expect(runtime.installDocumentDependency()).rejects.toThrow('aborted');
  expect(existsSync(root)).toBe(false);
  expect(runtime.documentDependency().status).toBe('missing');
  cancelInstall = false;
  mocks.digests = [...platforms[0]!.hashes];
  await runtime.installDocumentDependency();
  expect(runtime.documentDependency().status).toBe('ready');
});

it('cleans up a failed initial self-test and invalidates an installed broken runtime', async () => {
  await setup();
  failVerification = true;
  await expect(runtime.installDocumentDependency()).rejects.toThrow('broken native library');
  expect(existsSync(root)).toBe(false);
  failVerification = false;
  mocks.digests = [...platforms[0]!.hashes];
  await runtime.installDocumentDependency();
  failVerification = true;
  await expect(runtime.verifyDocumentRuntime()).rejects.toThrow('broken native library');
  expect(existsSync(join(root, 'ready'))).toBe(false);
  expect(runtime.documentDependency()).toEqual({
    status: 'error',
    error: '文档组件检查失败，请重新安装',
  });
});

it.each([
  { platform: 'darwin', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
])('rejects unsupported $platform/$arch without downloading', async (platform) => {
  await setup({ ...platforms[0]!, ...platform });
  await expect(runtime.installDocumentDependency()).rejects.toThrow('Apple Silicon Mac');
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(existsSync(root)).toBe(false);
});
