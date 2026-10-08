// 项目内置终端（Git Bash）：dela 命令桥注入（rcfile + 专用 env）、PTY 生命周期
//（输入/尺寸/输出回放/退出后只读）、进程回收（单标签/项目/窗口）、调用方校验。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  app: new Map<string, () => void>(),
  spawn: vi.fn(),
  directory: vi.fn(),
  check: vi.fn(),
}));
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
vi.mock('../ipc', () => ({ checkWorkspaceSender: mocks.check }));
vi.mock('../workspace/api', async () => {
  const { z } = await import('zod');
  return { idSchema: z.uuid(), projectDirectory: mocks.directory };
});
import { registerTerminalIpc } from '../terminal';
import { locateBash } from '../agent/tools/kernel/bash';

const state = vi.hoisted(() => ({ root: '' }));
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
  mocks.app.get('before-quit')!();
  vi.clearAllMocks();
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

afterAll(() => {
  rmSync(state.root, { recursive: true, force: true });
});

describe('项目内置终端', () => {
  it('以 Git Bash 启动并注入 dela 命令桥（专用端口/token 与 rcfile 函数）', async () => {
    const id = randomUUID();
    const snapshot = await invoke('create', owner, projectId, id);
    expect(snapshot).toMatchObject({ title: 'Git Bash' });
    const [file, args, options] = mocks.spawn.mock.calls[0]! as [
      string,
      string[],
      { env: Record<string, string>; cwd: string },
    ];
    expect(file).toBe(locateBash());
    expect(args[0]).toBe('--rcfile');
    expect(args.at(-1)).toBe('-i');
    expect(options.cwd).toBe('E:\\项目 ; & 中文');
    // 桥只进本会话环境：随机端口 + 专用 token。
    expect(options.env.DELA_COMMAND_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(options.env.DELA_COMMAND_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(options.env.MSYSTEM).toBe('MINGW64');
    // rcfile 链回标准初始化并定义 dela 函数；会话关闭后随临时目录回收。
    const rc = args[1]!;
    expect(existsSync(rc)).toBe(true);
    invoke('close', owner, id);
    expect(existsSync(rc)).toBe(false);
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
