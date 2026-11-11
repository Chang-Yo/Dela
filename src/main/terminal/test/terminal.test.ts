// 项目内置终端（Git Bash）的回归：命令桥注入、PTY 生命周期与进程回收。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  app: new Map<string, () => void>(),
  spawn: vi.fn(),
  directory: vi.fn(),
  check: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      path === '/bin/bash' ? state.systemBash : actual.existsSync(path),
  };
});
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
  },
  app: {
    on: (name: string, fn: () => void) => mocks.app.set(name, fn),
    getPath: () => state.root,
    // 开发模式：随包 MinGit 与搜索工具分别探到 .build/mingit 与 vendor/bin（均相对 app 根）。
    isPackaged: false,
    getAppPath: () => state.root,
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
import { locateBash } from '..';

const state = vi.hoisted(() => ({ root: '', systemBash: true }));
// kernel/bash → commands → 领域模块链用真实实现（桥服务器真实监听 127.0.0.1 随机端口）。

registerTerminalIpc();
const owner = Object.assign(new EventEmitter(), { id: 1, send: vi.fn(), isDestroyed: () => false });
const other = Object.assign(new EventEmitter(), { id: 2, send: vi.fn(), isDestroyed: () => false });
const invoke = (name: string, sender: typeof owner, ...args: unknown[]) =>
  mocks.handlers.get(`terminal:${name}`)!({ sender }, ...args);
const projectId = randomUUID();
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
  for (const name of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'])
    vi.stubEnv(name, state.root);
  vi.stubEnv('MSYSTEM', undefined);
  rmSync(state.root, { recursive: true, force: true });
  mkdirSync(join(state.root, 'Git', 'bin'), { recursive: true });
  writeFileSync(join(state.root, 'Git', 'bin', 'bash.exe'), '');
  state.systemBash = true;
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
  it('以对应平台 Bash 启动并注入 dela 命令桥（专用端口/token 与 rcfile 函数）', async () => {
    const id = randomUUID();
    const snapshot = await invoke('create', owner, projectId, id);
    expect(snapshot).toMatchObject({ title: platform === 'darwin' ? 'Bash' : 'Git Bash' });
    const [file, args, options] = mocks.spawn.mock.calls[0]! as [
      string,
      string[],
      { env: Record<string, string>; cwd: string; useConptyDll?: boolean },
    ];
    expect(file).toBe(locateBash());
    expect(args[0]).toBe('--rcfile');
    expect(args.at(-1)).toBe('-i');
    expect(options.cwd).toBe('E:\\项目 ; & 中文');
    // 桥只进本会话环境：随机端口 + 专用 token。
    expect(options.env.DELA_COMMAND_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(options.env.DELA_COMMAND_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(options.env.MSYSTEM).toBe(platform === 'win32' ? 'MINGW64' : undefined);
    expect(options.useConptyDll).toBe(platform === 'win32' ? true : undefined);
    const rc = args[1]!;
    expect(existsSync(rc)).toBe(true);
    expect(readFileSync(rc, 'utf8')).toContain(
      platform === 'darwin' ? '/etc/bashrc' : '/etc/bash.bashrc',
    );
    invoke('close', owner, id);
    expect(existsSync(rc)).toBe(false);
  });

  it('启动失败时清理 rcfile，不留下会话', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await expect(invoke('create', owner, projectId, randomUUID())).rejects.toThrow('spawn failed');
    const rc = mocks.spawn.mock.calls[0]![1][1];
    expect(existsSync(rc)).toBe(false);
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

  it('关闭单个、整个 Terminal 标签或窗口时杀死所属进程并回收命令桥', async () => {
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

describe('Git Bash 定位', () => {
  beforeEach(() => {
    rmSync(join(state.root, 'Git'), { recursive: true, force: true });
  });

  it('系统 Git for Windows 优先，其次随包 MinGit；都缺失时提示安装后重启', () => {
    const bundled = join(state.root, '.build', 'mingit', 'usr', 'bin', 'bash.exe');
    const system = join(state.root, 'Git', 'bin', 'bash.exe');
    expect(() => locateBash()).toThrow('后重启 Dela');
    mkdirSync(join(bundled, '..'), { recursive: true });
    writeFileSync(bundled, '');
    expect(locateBash()).toBe(bundled);
    mkdirSync(join(system, '..'), { recursive: true });
    writeFileSync(system, '');
    expect(locateBash()).toBe(system);
    rmSync(join(bundled, '..', '..', '..'), { recursive: true, force: true });
  });

  it('macOS 固定使用系统 Bash，缺失时明确报错', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    expect(locateBash()).toBe('/bin/bash');
    state.systemBash = false;
    expect(() => locateBash()).toThrow('macOS 系统 Bash');
  });
});
