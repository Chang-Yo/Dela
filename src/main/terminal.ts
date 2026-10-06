import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { z } from 'zod';
import { checkWorkspaceSender } from './ipc';
import { idSchema, projectDirectory } from './workspace/api';
import type { TerminalEvent, TerminalSession } from '../shared/terminal';

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
    projectDirectory(projectId);
    return [...sessions.values()]
      .filter((session) => session.owner === owner && session.projectId === projectId)
      .map((session) => ({ ...session.snapshot }));
  });
  handle('create', (owner, projectId, id) => {
    const cwd = projectDirectory(projectId);
    const parsedId = idSchema.parse(id);
    if (sessions.has(parsedId)) throw new Error('终端会话已存在');
    const windows = process.platform === 'win32';
    const shell = windows ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    // Electron 是中间进程，不能把 PowerShell 7 的模块目录传给 Windows PowerShell。
    // 仅处理子进程副本，让 Windows PowerShell 按官方规则重建自己的默认模块路径。
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !windows || key.toLowerCase() !== 'psmodulepath',
      ),
    );
    const pty = spawn(shell, windows ? ['-NoLogo'] : ['-l'], {
      name: 'xterm-256color',
      cwd,
      cols: 80,
      rows: 24,
      // 与 VS Code 默认一致，使用随包分发的 ConPTY，避免系统版本的关闭竞态。
      ...(windows ? { useConptyDll: true } : {}),
      env: { ...env, TERM: 'xterm-256color' },
    });
    const snapshot: TerminalSession = {
      id: parsedId,
      title: windows ? 'PowerShell' : shell.split('/').at(-1)!,
      buffer: '',
      sequence: 0,
      exitCode: null,
    };
    const session = { projectId: idSchema.parse(projectId), owner, pty, snapshot };
    sessions.set(parsedId, session);
    const send = (event: TerminalEvent) => {
      if (sessions.get(parsedId) === session && !owner.isDestroyed())
        owner.send('terminal:event', event);
    };
    pty.onData((data) => {
      snapshot.buffer = (snapshot.buffer + data).slice(-BUFFER_LIMIT);
      send({
        type: 'data',
        projectId: session.projectId,
        id: parsedId,
        sequence: ++snapshot.sequence,
        data,
      });
    });
    pty.onExit(({ exitCode }) => {
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
  app.on('before-quit', () => {
    for (const id of sessions.keys()) closeSession(id);
  });
}
