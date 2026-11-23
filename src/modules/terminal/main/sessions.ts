import { app } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { lstatSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { emit } from '../../../core/ports';
import { locateSsh, shellQuote } from '../../../core/remote/transport';
import { remoteById } from '../../remotes';
import { projectLocation } from '../../workspace';
import { terminalContract, type TerminalSession } from '../contract';

const SSH_CONNECT_TIMEOUT_SECONDS = 10;

function systemShell(): { file: string; args: string[]; title: string } {
  if (process.platform === 'win32') {
    const pwsh = [
      ...(process.env.PATH ?? '').split(';').filter(Boolean),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7'),
    ]
      .map((directory) => join(directory, 'pwsh.exe'))
      // 商店版 pwsh 是应用执行别名，existsSync 认不出，lstat 能认出。
      .find((path) => lstatSync(path, { throwIfNoEntry: false }));
    const windowsPowerShell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    return { file: pwsh ?? windowsPowerShell, args: ['-NoLogo'], title: 'PowerShell' };
  }
  // 终端用登录 shell；Agent 在 Mac 用 /bin/bash、不跑登录 shell，
  // 只写在 Zsh 初始化里的 SDK 环境，终端可见、Agent 不一定可见。
  const file = userInfo().shell || '/bin/zsh';
  return { file, args: ['-l'], title: basename(file) };
}

// 重挂载时回放最近输出；每个终端最多保留约 100 万字符，避免长期任务无限占用内存。
const BUFFER_LIMIT = 1024 * 1024;
const sessions = new Map<string, { projectId: string; pty: IPty; snapshot: TerminalSession }>();

function session(id: string) {
  const found = sessions.get(id);
  if (!found) throw new Error('终端会话不存在');
  return found;
}

export function listTerminals(projectId: string): TerminalSession[] {
  projectLocation(projectId);
  return [...sessions.values()]
    .filter((item) => item.projectId === projectId)
    .map((item) => ({ ...item.snapshot }));
}

export function createTerminal(projectId: string, id: string): TerminalSession {
  const location = projectLocation(projectId);
  if (sessions.has(id)) throw new Error('终端会话已存在');
  let pty: IPty;
  let title: string;
  if (location.kind === 'remote') {
    // 不加 BatchMode：交互终端可以让 ssh 自己问密码或询问主机指纹。
    const connection = remoteById(location.remoteId);
    const sshArgs = [
      '-tt',
      '-o',
      `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
      ...(connection.port ? ['-p', String(connection.port)] : []),
      ...(connection.keyPath ? ['-i', connection.keyPath] : []),
      connection.host,
      `cd ${shellQuote(location.path)} && exec bash -li`,
    ];
    pty = spawn(locateSsh(), sshArgs, {
      name: 'xterm-256color',
      cwd: app.getPath('home'),
      cols: 80,
      rows: 24,
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    title = connection.label;
  } else {
    const shell = systemShell();
    pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cwd: location.path,
      cols: 80,
      rows: 24,
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    title = shell.title;
  }
  const snapshot: TerminalSession = { id, title, buffer: '', sequence: 0, exitCode: null };
  const current = { projectId, pty, snapshot };
  sessions.set(id, current);
  const live = () => sessions.get(id) === current;
  // ConPTY 高吞吐时每个小块一条 IPC；8ms 合并成批。
  let pendingData = '';
  let dataFlushTimer: ReturnType<typeof setTimeout> | undefined;
  const flushData = () => {
    dataFlushTimer = undefined;
    if (!pendingData) return;
    const data = pendingData;
    pendingData = '';
    snapshot.buffer = (snapshot.buffer + data).slice(-BUFFER_LIMIT);
    const sequence = ++snapshot.sequence;
    if (live()) emit(terminalContract, 'event', { type: 'data', projectId, id, sequence, data });
  };
  pty.onData((data) => {
    pendingData += data;
    if (dataFlushTimer === undefined) dataFlushTimer = setTimeout(flushData, 8);
  });
  pty.onExit(({ exitCode }) => {
    if (dataFlushTimer !== undefined) {
      clearTimeout(dataFlushTimer);
      flushData();
    }
    snapshot.exitCode = exitCode;
    const sequence = ++snapshot.sequence;
    if (live())
      emit(terminalContract, 'event', { type: 'exit', projectId, id, sequence, exitCode });
  });
  return { ...snapshot };
}

export function writeTerminal(id: string, data: string): void {
  const current = session(id);
  if (current.snapshot.exitCode !== null) throw new Error('终端进程已结束');
  current.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const current = session(id);
  if (current.snapshot.exitCode === null) current.pty.resize(cols, rows);
}

function closeSession(id: string) {
  const current = sessions.get(id);
  if (!current) return;
  sessions.delete(id);
  if (current.snapshot.exitCode === null) current.pty.kill();
}

export function closeTerminal(id: string): void {
  closeSession(session(id).snapshot.id);
}

export function closeProjectTerminals(projectId: string): void {
  for (const [id, current] of sessions) if (current.projectId === projectId) closeSession(id);
}

export function closeAllTerminals(): void {
  for (const id of sessions.keys()) closeSession(id);
}
