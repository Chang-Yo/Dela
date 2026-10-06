import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

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
  app: { on: (name: string, fn: () => void) => mocks.app.set(name, fn) },
}));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('../ipc', () => ({ checkWorkspaceSender: mocks.check }));
vi.mock('../workspace/api', async () => {
  const { z } = await import('zod');
  return { idSchema: z.uuid(), projectDirectory: mocks.directory };
});
import { registerTerminalIpc } from '../terminal';

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

describe('项目内置终端', () => {
  it('Windows 子终端不继承宿主 PowerShell 7 的模块路径，保留其他环境', () => {
    if (process.platform !== 'win32') return;
    vi.stubEnv('PSModulePath', 'C:\\PowerShell7\\Modules');
    vi.stubEnv('DELA_TERMINAL_ENV_TEST', 'preserved');
    try {
      invoke('create', owner, projectId, randomUUID());
      const options = mocks.spawn.mock.calls[0]![2];
      expect(Object.keys(options.env).some((key) => key.toLowerCase() === 'psmodulepath')).toBe(
        false,
      );
      expect(options.env.DELA_TERMINAL_ENV_TEST).toBe('preserved');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('解析当前项目目录启动 PTY，隔离窗口并转发输入、尺寸与输出', () => {
    const id = randomUUID();
    invoke('create', owner, projectId, id);
    expect(mocks.directory).toHaveBeenCalledWith(projectId);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: 'E:\\项目 ; & 中文' }),
    );
    invoke('write', owner, id, '中文\r');
    expect(pty.write).toHaveBeenCalledWith('中文\r');
    invoke('resize', owner, id, 120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    expect(() => invoke('resize', owner, id, 0, 40)).toThrow();
    expect(() => invoke('write', other, id, 'x')).toThrow('终端会话不存在');
    data('输出中文');
    expect(owner.send).toHaveBeenLastCalledWith(
      'terminal:event',
      expect.objectContaining({ type: 'data', id, data: '输出中文', sequence: 1 }),
    );
    expect(invoke('list', owner, projectId)).toEqual([
      expect.objectContaining({ id, buffer: '输出中文', sequence: 1 }),
    ]);
    expect(invoke('list', other, projectId)).toEqual([]);
  });
  it('结束后保留输出供重挂载回放，不能再写入', () => {
    const id = randomUUID();
    invoke('create', owner, projectId, id);
    data('done');
    exit({ exitCode: 3 });
    expect(invoke('list', owner, projectId)).toEqual([
      expect.objectContaining({ id, buffer: 'done', exitCode: 3 }),
    ]);
    expect(() => invoke('write', owner, id, 'x')).toThrow('终端进程已结束');
    invoke('close', owner, id);
    expect(pty.kill).not.toHaveBeenCalled();
  });
  it('关闭单个、整个 Terminal 标签或窗口时杀死所属进程', () => {
    const id = randomUUID();
    invoke('create', owner, projectId, id);
    invoke('close-project', other, projectId);
    expect(pty.kill).not.toHaveBeenCalled();
    invoke('close', owner, id);
    expect(pty.kill).toHaveBeenCalledOnce();
    invoke('create', owner, projectId, randomUUID());
    invoke('close-project', owner, projectId);
    expect(pty.kill).toHaveBeenCalledTimes(2);
    invoke('create', owner, projectId, randomUUID());
    owner.emit('destroyed');
    expect(pty.kill).toHaveBeenCalledTimes(3);
    expect(invoke('list', owner, projectId)).toEqual([]);
  });
  it('拒绝非项目/不可信调用，不启动进程', () => {
    mocks.directory.mockImplementation(() => {
      throw new Error('只有项目可以使用此入口');
    });
    expect(() => invoke('create', owner, projectId, randomUUID())).toThrow('只有项目');
    expect(mocks.spawn).not.toHaveBeenCalled();
    mocks.check.mockImplementationOnce(() => {
      throw new Error('不允许的调用来源');
    });
    expect(() => invoke('list', owner, projectId)).toThrow('不允许的调用来源');
  });
});
