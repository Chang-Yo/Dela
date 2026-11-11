// 项目内置终端的回归：跟随系统 shell、PTY 生命周期与进程回收。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  app: new Map<string, () => void>(),
  spawn: vi.fn(),
  directory: vi.fn(),
  check: vi.fn(),
}));
const state = vi.hoisted(() => ({ root: '', loginShell: '/bin/zsh' as string | null }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), shell: state.loginShell }) };
});
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
  },
  app: {
    on: (name: string, fn: () => void) => mocks.app.set(name, fn),
    getPath: () => state.root,
  },
}));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: mocks.check }));
vi.mock('../../workspace/api', async () => {
  const { z } = await import('zod');
  return {
    idSchema: z.uuid(),
    // 终端只认 projectLocation 的结果：本地项目给出磁盘目录。
    projectLocation: (id: unknown) => ({ kind: 'local', path: mocks.directory(id) }),
  };
});
import { registerTerminalIpc } from '..';

registerTerminalIpc();
const owner = Object.assign(new EventEmitter(), { id: 1, send: vi.fn(), isDestroyed: () => false });
const other = Object.assign(new EventEmitter(), { id: 2, send: vi.fn(), isDestroyed: () => false });
const invoke = (name: string, sender: typeof owner, ...args: unknown[]) =>
  mocks.handlers.get(`terminal:${name}`)!({ sender }, ...args);
const projectId = randomUUID();
const spawned = () =>
  mocks.spawn.mock.calls.at(-1)! as [
    string,
    string[],
    { env: Record<string, string>; cwd: string; useConptyDll?: boolean },
  ];
const touch = (path: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
};
let data: (text: string) => void;
let exit: (event: { exitCode: number }) => void;
let pty: {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-terminal-'));
});

beforeEach(() => {
  mocks.app.get('will-quit')!();
  vi.clearAllMocks();
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  vi.stubEnv('ProgramFiles', join(state.root, 'Program Files'));
  vi.stubEnv('SystemRoot', join(state.root, 'Windows'));
  vi.stubEnv('PATH', join(state.root, 'bin'));
  rmSync(state.root, { recursive: true, force: true });
  state.loginShell = '/bin/zsh';
  mocks.directory.mockReturnValue('E:\\项目 ; & 中文');
  pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  mocks.spawn.mockReturnValue({
    ...pty,
    onData: (listener: typeof data) => {
      data = listener;
    },
    onExit: (listener: typeof exit) => {
      exit = listener;
    },
  });
});

afterEach(() => {
  mocks.app.get('will-quit')!();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(state.root, { recursive: true, force: true });
});

describe('跟随系统 shell', () => {
  it('Windows 优先 PATH 上的 pwsh，其次 PowerShell 7 安装目录，最后系统自带 5.1', async () => {
    const installed = join(state.root, 'Program Files', 'PowerShell', '7', 'pwsh.exe');
    const onPath = join(state.root, 'bin', 'pwsh.exe');
    await invoke('create', owner, projectId, randomUUID());
    expect(spawned()[0]).toBe(
      join(state.root, 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    touch(installed);
    await invoke('create', owner, projectId, randomUUID());
    expect(spawned()[0]).toBe(installed);
    touch(onPath);
    const snapshot = await invoke('create', owner, projectId, randomUUID());
    const [file, args, options] = spawned();
    expect(file).toBe(onPath);
    expect(args).toEqual(['-NoLogo']);
    expect(snapshot).toMatchObject({ title: 'PowerShell' });
    expect(options).toMatchObject({ cwd: 'E:\\项目 ; & 中文', useConptyDll: true });
    expect(options.env.DELA_COMMAND_URL).toBeUndefined();
  });

  it('macOS 以登录 shell 启动用户自己的 shell，取不到时用 zsh', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    state.loginShell = '/opt/homebrew/bin/fish';
    const snapshot = await invoke('create', owner, projectId, randomUUID());
    expect(spawned().slice(0, 2)).toEqual(['/opt/homebrew/bin/fish', ['-l']]);
    expect(snapshot).toMatchObject({ title: 'fish' });
    state.loginShell = null;
    await invoke('create', owner, projectId, randomUUID());
    expect(spawned()[0]).toBe('/bin/zsh');
  });
});

describe.each(['win32', 'darwin'])('项目内置终端（%s）', (platform) => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform }));
  it('退出尚未获准时不清理终端，实际退出才回收', async () => {
    await invoke('create', owner, projectId, randomUUID());
    mocks.app.get('before-quit')?.();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(await invoke('list', owner, projectId)).toHaveLength(1);
    mocks.app.get('will-quit')!();
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(await invoke('list', owner, projectId)).toEqual([]);
  });

  it('启动失败时不留下会话', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await expect(invoke('create', owner, projectId, randomUUID())).rejects.toThrow('spawn failed');
    expect(await invoke('list', owner, projectId)).toEqual([]);
  });

  it('解析当前项目目录启动 PTY，转发输入、尺寸与输出', async () => {
    const id = randomUUID();
    await invoke('create', owner, projectId, id);
    expect(mocks.directory).toHaveBeenCalledWith(projectId);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    invoke('write', owner, id, '中文\r');
    expect(pty.write).toHaveBeenCalledWith('中文\r');
    invoke('resize', owner, id, 120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    expect(() => invoke('resize', owner, id, 0, 40)).toThrow();
    expect(() => invoke('write', other, id, 'x')).toThrow('终端会话不存在');
    // 输出按 8ms 合并成批发送：多条小块只产生一条 IPC，回放缓冲也只拼接一次。
    vi.useFakeTimers();
    data('输出中文');
    data('，追加');
    vi.advanceTimersByTime(8);
    vi.useRealTimers();
    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(owner.send).toHaveBeenLastCalledWith(
      'terminal:event',
      expect.objectContaining({ type: 'data', id, data: '输出中文，追加', sequence: 1 }),
    );
    expect(await invoke('list', owner, projectId)).toEqual([
      expect.objectContaining({ id, buffer: '输出中文，追加', sequence: 1 }),
    ]);
    expect(await invoke('list', other, projectId)).toEqual([]);
  });

  it('结束后保留输出供重挂载回放，不能再写入', async () => {
    const id = randomUUID();
    await invoke('create', owner, projectId, id);
    data('done');
    exit({ exitCode: 3 });
    expect(await invoke('list', owner, projectId)).toEqual([
      expect.objectContaining({ id, buffer: 'done', exitCode: 3 }),
    ]);
    expect(() => invoke('write', owner, id, 'x')).toThrow('终端进程已结束');
    invoke('close', owner, id);
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it('关闭单个、整个 Terminal 标签或窗口时杀死所属进程', async () => {
    const id = randomUUID();
    await invoke('create', owner, projectId, id);
    invoke('close-project', other, projectId);
    expect(pty.kill).not.toHaveBeenCalled();
    invoke('close', owner, id);
    expect(pty.kill).toHaveBeenCalledOnce();
    await invoke('create', owner, projectId, randomUUID());
    invoke('close-project', owner, projectId);
    expect(pty.kill).toHaveBeenCalledTimes(2);
    await invoke('create', owner, projectId, randomUUID());
    owner.emit('destroyed');
    expect(pty.kill).toHaveBeenCalledTimes(3);
    expect(await invoke('list', owner, projectId)).toEqual([]);
  });

  it('拒绝非项目/不可信调用，不启动进程', async () => {
    mocks.directory.mockImplementation(() => {
      throw new Error('只有项目可以使用此入口');
    });
    await expect(invoke('create', owner, projectId, randomUUID())).rejects.toThrow('只有项目');
    expect(mocks.spawn).not.toHaveBeenCalled();
    mocks.check.mockImplementationOnce(() => {
      throw new Error('不允许的调用来源');
    });
    // 通道包装层同步校验调用来源（未进入 async 处理器）。
    expect(() => invoke('list', owner, projectId)).toThrow('不允许的调用来源');
  });
});
