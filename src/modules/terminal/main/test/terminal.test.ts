// 项目内置终端的回归：跟随系统 shell、PTY 生命周期与进程回收。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  app: new Map<string, () => void>(),
  spawn: vi.fn(),
  directory: vi.fn(),
  emit: vi.fn(),
}));
const state = vi.hoisted(() => ({ root: '', loginShell: '/bin/zsh' as string | null }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), shell: state.loginShell }) };
});
vi.mock('electron', () => ({
  app: {
    on: (name: string, fn: () => void) => mocks.app.set(name, fn),
    getPath: () => state.root,
  },
}));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('../../../../core/ports', () => ({ emit: mocks.emit }));
vi.mock('../../../remotes', () => ({ remoteById: vi.fn() }));
vi.mock('../../../workspace', () => ({
  projectLocation: (id: unknown) => ({ kind: 'local', path: mocks.directory(id) }),
}));
import { closeAllTerminals, terminalModule } from '../..';

terminalModule.register!();
const invoke = async (name: string, input?: unknown) => terminalModule.ipc!.call(name, input);
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
    await invoke('create', { projectId, id: randomUUID() });
    expect(spawned()[0]).toBe(
      join(state.root, 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    touch(installed);
    await invoke('create', { projectId, id: randomUUID() });
    expect(spawned()[0]).toBe(installed);
    touch(onPath);
    const snapshot = await invoke('create', { projectId, id: randomUUID() });
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
    const snapshot = await invoke('create', { projectId, id: randomUUID() });
    expect(spawned().slice(0, 2)).toEqual(['/opt/homebrew/bin/fish', ['-l']]);
    expect(snapshot).toMatchObject({ title: 'fish' });
    state.loginShell = null;
    await invoke('create', { projectId, id: randomUUID() });
    expect(spawned()[0]).toBe('/bin/zsh');
  });
});

describe.each(['win32', 'darwin'])('项目内置终端（%s）', (platform) => {
  beforeEach(() => vi.stubGlobal('process', { ...process, platform }));
  it('退出尚未获准时不清理终端，实际退出才回收', async () => {
    await invoke('create', { projectId, id: randomUUID() });
    mocks.app.get('before-quit')?.();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(await invoke('list', projectId)).toHaveLength(1);
    mocks.app.get('will-quit')!();
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(await invoke('list', projectId)).toEqual([]);
  });

  it('启动失败时不留下会话', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await expect(invoke('create', { projectId, id: randomUUID() })).rejects.toThrow('spawn failed');
    expect(await invoke('list', projectId)).toEqual([]);
  });

  it('解析当前项目目录启动 PTY，转发输入、尺寸与输出', async () => {
    const id = randomUUID();
    await invoke('create', { projectId, id });
    expect(mocks.directory).toHaveBeenCalledWith(projectId);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    await invoke('write', { id, data: '中文\r' });
    expect(pty.write).toHaveBeenCalledWith('中文\r');
    await invoke('resize', { id, cols: 120, rows: 40 });
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    // 输出按 8ms 合并成批发送：多条小块只产生一条 IPC，回放缓冲也只拼接一次。
    vi.useFakeTimers();
    data('输出中文');
    data('，追加');
    vi.advanceTimersByTime(8);
    vi.useRealTimers();
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.anything(),
      'event',
      expect.objectContaining({ type: 'data', id, data: '输出中文，追加', sequence: 1 }),
    );
    expect(await invoke('list', projectId)).toEqual([
      expect.objectContaining({ id, buffer: '输出中文，追加', sequence: 1 }),
    ]);
    expect(await invoke('list', randomUUID())).toEqual([]);
  });

  it('结束后保留输出供重挂载回放，不能再写入', async () => {
    const id = randomUUID();
    await invoke('create', { projectId, id });
    data('done');
    exit({ exitCode: 3 });
    expect(await invoke('list', projectId)).toEqual([
      expect.objectContaining({ id, buffer: 'done', exitCode: 3 }),
    ]);
    await expect(invoke('write', { id, data: 'x' })).rejects.toThrow('终端进程已结束');
    await invoke('close', id);
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it('关闭单个、整个 Terminal 标签或窗口时杀死所属进程', async () => {
    const id = randomUUID();
    await invoke('create', { projectId, id });
    await invoke('closeProject', randomUUID());
    expect(pty.kill).not.toHaveBeenCalled();
    await invoke('close', id);
    expect(pty.kill).toHaveBeenCalledOnce();
    await invoke('create', { projectId, id: randomUUID() });
    await invoke('closeProject', projectId);
    expect(pty.kill).toHaveBeenCalledTimes(2);
    await invoke('create', { projectId, id: randomUUID() });
    closeAllTerminals();
    expect(pty.kill).toHaveBeenCalledTimes(3);
    expect(await invoke('list', projectId)).toEqual([]);
  });

  it('拒绝非项目调用，不启动进程', async () => {
    mocks.directory.mockImplementation(() => {
      throw new Error('只有项目可以使用此入口');
    });
    await expect(invoke('create', { projectId, id: randomUUID() })).rejects.toThrow('只有项目');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
