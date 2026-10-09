import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { checkWorkspaceSender } from './ipc';
import { idSchema, projectLocation } from './workspace/api';
import { remoteById } from './remotes/api';
import { locateSsh, shellQuote } from './remotes/transport';
import { COMMAND_BRIDGE } from './agent/commands';
import { domainBridge } from './agent';
import type { TerminalEvent, TerminalSession } from '../shared/terminal';

const SSH_CONNECT_TIMEOUT_SECONDS = 10;

/** 定位 Git Bash：常见安装位置探测；缺失时明确报错，不回退 PowerShell 或 PATH 上的 bash（可能是 WSL）。 */
export function locateBash(): string {
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git\\bin\\bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git\\bin\\bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs\\Git\\bin\\bash.exe'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      '未找到 Git Bash：请安装 Git for Windows（https://git-scm.com/download/win）后重试',
    );
  return found;
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
    /** rcfile 临时目录随会话回收。 */
    cleanup: () => void;
  }
>();

function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.snapshot.exitCode === null) session.pty.kill();
  session.cleanup();
}

function ownedSession(owner: WebContents, id: unknown) {
  const session = sessions.get(idSchema.parse(id));
  if (!session || session.owner !== owner) throw new Error('终端会话不存在');
  return session;
}

/** 终端与内核 Bash 同源（Git Bash）：经 --rcfile 链回标准初始化后注入 dela 命令桥，
 *  使 skills 的领域命令在交互终端同样可用；桥的 URL/token 只进本会话环境。 */
function writeRcfile(): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'dela-terminal-'));
  const path = join(directory, 'rc');
  writeFileSync(
    path,
    '[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc\n[ -f ~/.bashrc ] && . ~/.bashrc\n' +
      COMMAND_BRIDGE +
      '\n',
  );
  return { path, cleanup: () => rmSync(directory, { force: true, recursive: true }) };
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
    let cleanup = () => {};
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
        useConptyDll: true,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      title = connection.label;
    } else {
      const bridge = await domainBridge();
      const rcfile = writeRcfile();
      cleanup = rcfile.cleanup;
      pty = spawn(locateBash(), ['--rcfile', rcfile.path, '-i'], {
        name: 'xterm-256color',
        cwd: location.path,
        cols: 80,
        rows: 24,
        // 与 VS Code 默认一致，使用随包分发的 ConPTY，避免系统版本的关闭竞态。
        useConptyDll: true,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          // 对齐 Git Bash 快捷方式的行为（登录 shell 由 profile 处理 MSYSTEM）。
          MSYSTEM: 'MINGW64',
          DELA_COMMAND_URL: bridge.url,
          DELA_COMMAND_TOKEN: bridge.token,
        },
      });
      title = 'Git Bash';
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
      cleanup,
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
  app.on('before-quit', () => {
    for (const id of sessions.keys()) closeSession(id);
  });
}
