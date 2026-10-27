import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const state = vi.hoisted(() => ({ root: '', packaged: false }));
vi.mock('electron', () => ({
  app: {
    getPath: () => state.root,
    getAppPath: () => state.root,
    get isPackaged() {
      return state.packaged;
    },
  },
}));

let runtime: typeof import('../mingit');
const touch = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
};

beforeEach(async () => {
  vi.resetModules();
  state.root = mkdtempSync(join(tmpdir(), 'dela-runtime-'));
  state.packaged = false;
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    arch: 'arm64',
    resourcesPath: join(state.root, 'resources'),
  });
  vi.stubEnv('PATH', '/custom/bin:/usr/bin');
  vi.stubEnv('LOCALAPPDATA', state.root);
  runtime = await import('../mingit');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(state.root, { recursive: true, force: true });
});

describe.each(['arm64', 'x64'])('macOS 搜索工具（%s）', (arch) => {
  it.each([false, true])(
    '开发/打包路径选择正确，保持 PATH 顺序且不重复前插（packaged=%s）',
    (packaged) => {
      vi.stubGlobal('process', { ...process, arch });
      state.packaged = packaged;
      const root = packaged
        ? join(process.resourcesPath, 'bin')
        : join(state.root, 'vendor', 'bin');
      const tools = join(root, `darwin-${arch}`);
      touch(join(tools, 'rg'));
      touch(join(tools, 'fd'));
      touch(join(root, 'rg.exe'));
      touch(join(root, 'fd.exe'));
      runtime.prependRuntimePath();
      const expected = [
        tools,
        '/custom/bin',
        '/usr/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ].join(':');
      expect(process.env.PATH).toBe(expected);
      runtime.prependRuntimePath();
      expect(process.env.PATH).toBe(expected);
    },
  );
});

it('macOS 不探测或下载 Windows MinGit；缺少搜索工具时不前插 exe 目录', async () => {
  touch(join(state.root, '.build', 'mingit', 'usr', 'bin', 'bash.exe'));
  touch(join(state.root, 'vendor', 'bin', 'rg.exe'));
  expect(runtime.mingitBash()).toBeNull();
  expect(runtime.bundledBash()).toBeNull();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    runtime.installMinGit({
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      onExtract: vi.fn(),
    }),
  ).rejects.toThrow('仅用于 Windows');
  expect(fetch).not.toHaveBeenCalled();
  runtime.prependRuntimePath();
  expect(process.env.PATH).not.toContain(state.root);
});

it('Windows 仍使用 MinGit cmd 和 exe 搜索工具，以分号分隔', () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  vi.stubEnv('PATH', 'C:\\Windows;C:\\custom');
  const mingit = join(state.root, '.build', 'mingit');
  const tools = join(state.root, 'vendor', 'bin');
  touch(join(mingit, 'usr', 'bin', 'bash.exe'));
  touch(join(tools, 'rg.exe'));
  touch(join(tools, 'fd.exe'));
  runtime.prependRuntimePath();
  expect(process.env.PATH).toBe(`${tools};${join(mingit, 'cmd')};C:\\Windows;C:\\custom`);
  runtime.prependRuntimePath();
  expect(process.env.PATH).toBe(`${tools};${join(mingit, 'cmd')};C:\\Windows;C:\\custom`);
});
