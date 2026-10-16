import { app, ipcMain, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { idSchema, projectLocation } from '../workspace/api';
import { remoteById } from '../remotes/api';
import { locateSsh, shellQuote } from '../remotes/transport';
import { COMMAND_BRIDGE } from '../agent/commands';
import { domainBridge } from '../agent';
import { MINGIT_BYTES, bundledBash, installMinGit, mingitBash } from './mingit';
import type {
  BashInstallSnapshot,
  BashStatus,
  TerminalEvent,
  TerminalSession,
} from '../../shared/terminal';

const SSH_CONNECT_TIMEOUT_SECONDS = 10;

function systemBash(): string | null {
  if (process.platform === 'darwin') return existsSync('/bin/bash') ? '/bin/bash' : null;
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** macOS 使用系统 Bash；Windows 先系统安装（Git for Windows），再随包 MinGit，再应用自装的 MinGit；
 *  都缺失时明确报错，不回退 PowerShell 或 PATH 上的 bash（可能是 WSL）。 */
export function locateBash(): string {
  if (process.platform === 'darwin') {
    const bash = systemBash();
    if (!bash) throw new Error('未找到 macOS 系统 Bash（/bin/bash），请检查系统环境');
    return bash;
  }
  return (
    systemBash() ??
    bundledBash() ??
    mingitBash() ??
    (() => {
      throw new Error(
        '未找到 Git Bash：可在终端页一键安装 Dela 运行时，或安装 Git for Windows（https://git-scm.com/download/win）后重试',
      );
    })()
  );
}

// MinGit 一键安装：主进程持有安装状态机，终端页经 bash-status 查询、事件收进度。
// 装完立即 prepend PATH，终端与 Agent 的 bash 内 git 随即可用。
const installState: BashInstallSnapshot = { phase: 'idle', received: 0, total: 0, error: null };
let installController: AbortController | null = null;

function bashStatus(): BashStatus {
  return {
    found:
      process.platform === 'darwin'
        ? Boolean(locateBash())
        : (systemBash() ?? bundledBash() ?? mingitBash()) !== null,
    install: { ...installState },
  };
}

async function runInstall(owner: WebContents): Promise<BashStatus> {
  const current = bashStatus();
  // 已装或进行中：直接回报现状，不重复发起。
  if (process.platform !== 'win32' || current.found || installController) return current;
  const controller = new AbortController();
  installController = controller;
  Object.assign(installState, {
    phase: 'downloading',
    received: 0,
    // headers 到达前先按已知的发布物大小展示进度，随后以 content-length 为准。
    total: MINGIT_BYTES,
    error: null,
  });
  // 高频进度节流到 100ms 一条 IPC，结束时再补发最终状态。
  let lastPublish = 0;
  const publish = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPublish < 100) return;
    lastPublish = now;
    if (!owner.isDestroyed()) owner.send('terminal:bash-install', { ...installState });
  };
  publish(true);
  try {
    await installMinGit({
      signal: controller.signal,
      onProgress: (received, total) => {
        installState.received = received;
        installState.total = total;
        publish();
      },
      onExtract: () => {
        installState.phase = 'extracting';
        publish(true);
      },
    });
    Object.assign(installState, { phase: 'done', error: null });
  } catch (cause) {
    const cancelled = controller.signal.aborted;
    Object.assign(installState, {
      phase: cancelled ? 'idle' : 'error',
      error: cancelled ? null : cause instanceof Error ? cause.message : String(cause),
    });
    if (!cancelled) throw new Error(installState.error!);
  } finally {
    installController = null;
    publish(true);
  }
  return bashStatus();
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

/** 终端与内核 Bash 同源：经 --rcfile 链回标准初始化后注入 dela 命令桥，
 *  使 skills 的领域命令在交互终端同样可用；桥的 URL/token 只进本会话环境。 */
function writeRcfile(): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'dela-terminal-'));
  const path = join(directory, 'rc');
  writeFileSync(
    path,
    (process.platform === 'darwin'
      ? '[ -f /etc/bashrc ] && . /etc/bashrc\n'
      : '[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc\n') +
      '[ -f ~/.bashrc ] && . ~/.bashrc\n' +
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
  handle('bash-status', () => bashStatus());
  handle('install-bash', (owner) => runInstall(owner));
  handle('cancel-install-bash', () => installController?.abort());
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
        ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      title = connection.label;
    } else {
      const bash = locateBash();
      const bridge = await domainBridge();
      const rcfile = writeRcfile();
      cleanup = rcfile.cleanup;
      try {
        pty = spawn(bash, ['--rcfile', rcfile.path, '-i'], {
          name: 'xterm-256color',
          cwd: location.path,
          cols: 80,
          rows: 24,
          // 与 VS Code 默认一致，使用随包分发的 ConPTY，避免系统版本的关闭竞态。
          ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            // 对齐 Git Bash 快捷方式的行为（登录 shell 由 profile 处理 MSYSTEM）。
            ...(process.platform === 'win32' ? { MSYSTEM: 'MINGW64' } : {}),
            DELA_COMMAND_URL: bridge.url,
            DELA_COMMAND_TOKEN: bridge.token,
          },
        });
      } catch (error) {
        cleanup();
        throw error;
      }
      title = process.platform === 'darwin' ? 'Bash' : 'Git Bash';
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
  app.on('will-quit', () => {
    for (const id of sessions.keys()) closeSession(id);
  });
}
