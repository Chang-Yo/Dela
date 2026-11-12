import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { lstatSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { idSchema, projectLocation } from '../workspace/api';
import { remoteById } from '../remotes/api';
import { locateSsh, shellQuote } from '../../core/remote/transport';
import type { TerminalEvent, TerminalSession } from '../../shared/terminal';

const SSH_CONNECT_TIMEOUT_SECONDS = 10;

/** 交互终端跟随用户自己的 shell：Windows 优先 PowerShell 7，再用系统自带 5.1；Mac 用登录 shell。 */
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
  const file = userInfo().shell || '/bin/zsh';
  return { file, args: ['-l'], title: basename(file) };
}

// 重挂载时回放最近输出；每个终端最多保留约 100 万字符，避免长期任务无限占用内存。
const BUFFER_LIMIT = 1024 * 1024;
const sessions = new Map<
  string,
  {
    projectId: string;
    owner: WebContents;
    pty: IPty;
    snapshot: TerminalSession;
  }
>();

function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.snapshot.exitCode === null) session.pty.kill();
}

function ownedSession(owner: WebContents, id: unknown) {
  const session = sessions.get(idSchema.parse(id));
  if (!session || session.owner !== owner) throw new Error('终端会话不存在');
  return session;
}

export function registerTerminalIpc() {
  const owners = new Set<number>();
  const handle = (name: string, fn: (owner: WebContents, ...args: unknown[]) => unknown) =>
    ipcMain.handle(`terminal:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event.sender, ...args);
    });
  handle('list', (owner, projectId) => {
    projectLocation(projectId);
    return [...sessions.values()]
      .filter((session) => session.owner === owner && session.projectId === projectId)
      .map((session) => ({ ...session.snapshot }));
  });
  handle('create', async (owner, projectId, id) => {
    const location = projectLocation(projectId);
    const parsedId = idSchema.parse(id);
    if (sessions.has(parsedId)) throw new Error('终端会话已存在');
    let pty: IPty;
    let title: string;
    if (location.kind === 'remote') {
      // 远程终端：本地 ssh -tt 申请远端 PTY，远端不需要部署 node-pty。
      // 这里刻意不加 BatchMode：交互终端可以让 ssh 自己问密码或询问主机指纹。
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
        // 与 VS Code 默认一致，使用随包分发的 ConPTY，避免系统版本的关闭竞态。
        ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      title = shell.title;
    }
    const snapshot: TerminalSession = {
      id: parsedId,
      title,
      buffer: '',
      sequence: 0,
      exitCode: null,
    };
    const session = {
      projectId: idSchema.parse(projectId),
      owner,
      pty,
      snapshot,
    };
    sessions.set(parsedId, session);
    const send = (event: TerminalEvent) => {
      if (sessions.get(parsedId) === session && !owner.isDestroyed())
        owner.send('terminal:event', event);
    };
    // ConPTY 高吞吐时每个小块一条 IPC，主进程回放缓冲与渲染端都要逐块拼接；
    // 8ms 合并成批：对交互延迟无感，IPC 频率与重复拼接都降一个数量级以上。
    let pendingData = '';
    let dataFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushData = () => {
      dataFlushTimer = undefined;
      if (!pendingData) return;
      const data = pendingData;
      pendingData = '';
      snapshot.buffer = (snapshot.buffer + data).slice(-BUFFER_LIMIT);
      send({
        type: 'data',
        projectId: session.projectId,
        id: parsedId,
        sequence: ++snapshot.sequence,
        data,
      });
    };
    pty.onData((data) => {
      pendingData += data;
      if (dataFlushTimer === undefined) dataFlushTimer = setTimeout(flushData, 8);
    });
    pty.onExit(({ exitCode }) => {
      if (dataFlushTimer !== undefined) {
        clearTimeout(dataFlushTimer);
        // 退出前先冲刷积压数据，保证渲染端按序收到全部输出。
        flushData();
      }
      snapshot.exitCode = exitCode;
      send({
        type: 'exit',
        projectId: session.projectId,
        id: parsedId,
        sequence: ++snapshot.sequence,
        exitCode,
      });
    });
    if (!owners.has(owner.id)) {
      owners.add(owner.id);
      owner.once('destroyed', () => {
        owners.delete(owner.id);
        for (const [id, session] of sessions) if (session.owner === owner) closeSession(id);
      });
    }
    return { ...snapshot };
  });
  handle('write', (owner, id, data) => {
    const session = ownedSession(owner, id);
    if (session.snapshot.exitCode !== null) throw new Error('终端进程已结束');
    session.pty.write(z.string().max(2_000_000).parse(data));
  });
  handle('resize', (owner, id, cols, rows) => {
    const session = ownedSession(owner, id);
    const size = z.number().int().min(1).max(1000);
    const width = size.parse(cols);
    const height = size.parse(rows);
    if (session.snapshot.exitCode === null) session.pty.resize(width, height);
  });
  handle('close', (owner, id) => {
    closeSession(ownedSession(owner, id).snapshot.id);
  });
  handle('close-project', (owner, projectId) => {
    const parsedId = idSchema.parse(projectId);
    for (const [id, session] of sessions)
      if (session.owner === owner && session.projectId === parsedId) closeSession(id);
  });
  app.on('will-quit', () => {
    for (const id of sessions.keys()) closeSession(id);
  });
}
