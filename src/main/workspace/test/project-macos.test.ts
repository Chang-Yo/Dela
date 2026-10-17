import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  exists: vi.fn(),
  remote: false,
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/test' },
  shell: { openPath: vi.fn() },
}));
vi.mock('node:child_process', () => ({ execFile: state.execFile, spawn: state.spawn }));
vi.mock('node:fs', () => ({ existsSync: state.exists }));
vi.mock('../api', () => ({
  projectDirectory: () => '/projects/项目 ; & 中文',
  remoteProjectOf: () => (state.remote ? { remoteId: 'remote', path: '/srv/项目 ; & 中文' } : null),
}));
vi.mock('../../remotes/api', () => ({ remoteById: () => ({ host: 'gpu-box' }) }));

import { openProjectDirectory } from '../project';
const id = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  vi.resetAllMocks();
  state.remote = false;
  state.execFile.mockImplementation((_command, _args, callback) =>
    callback(new Error('not found'), ''),
  );
  state.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
});
afterEach(() => vi.unstubAllGlobals());

it('优先使用 PATH 中的 code CLI，并将完整项目路径作为单个参数', async () => {
  state.execFile.mockImplementation((_command, _args, callback) =>
    callback(null, '/usr/local/bin/code\n'),
  );
  state.exists.mockImplementation((path: string) => path === '/usr/local/bin/code');
  await openProjectDirectory(id, 'vscode');
  expect(state.execFile).toHaveBeenCalledWith('/usr/bin/which', ['code'], expect.any(Function));
  expect(state.spawn).toHaveBeenCalledWith('/usr/local/bin/code', ['/projects/项目 ; & 中文'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
});

it.each(['/Applications', '/Users/test/Applications'])(
  '没有 CLI 链接时使用 %s 中应用自带的 CLI',
  async (directory) => {
    const cli = join(
      directory,
      'Visual Studio Code.app',
      'Contents',
      'Resources',
      'app',
      'bin',
      'code',
    );
    state.exists.mockImplementation((path: string) => path === cli);
    state.remote = true;
    await openProjectDirectory(id, 'vscode');
    expect(state.spawn).toHaveBeenCalledWith(
      cli,
      ['--remote', 'ssh-remote+gpu-box', '/srv/项目 ; & 中文'],
      { detached: true, stdio: 'ignore', windowsHide: false },
    );
  },
);

it('未安装时返回操作提示，不尝试启动 Windows 程序', async () => {
  state.exists.mockReturnValue(false);
  await expect(openProjectDirectory(id, 'vscode')).rejects.toThrow('未找到 VS Code');
  expect(state.spawn).not.toHaveBeenCalled();
});
