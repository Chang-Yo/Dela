/**
 * 后台任务：后台 bash 与后台子 Agent。任务结束时向父会话投递一条通知（只投一次）；
 * 归档、删除父会话与退出应用时全部结束，不投递，重启后不恢复。
 * bash 的完整输出写进日志文件，内存只留尾部；进程树由 Dela 自己结束。
 */
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { ToolDefinition, getShellConfig } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskView, TaskNoticeDetails, TaskStatus } from '../../shared/api';
import type { RemoteTarget } from '../remotes/transport';
import { remoteBackgroundBash, remoteOperations } from '../remotes/operations';
import { loadPi } from './pi';
import { deliverTaskNotice, publish } from './session';

export interface TaskOutcome {
  status: Exclude<TaskStatus, 'running'>;
  exitCode?: number | null;
  reply?: string | null;
  error?: string;
}

interface BackgroundTask {
  id: string;
  parentId: string;
  kind: 'bash' | 'subagent';
  label: string;
  startedAt: number;
  finishedAt?: number;
  status: TaskStatus;
  outcome?: TaskOutcome;
  stoppedBy?: 'user' | 'model' | 'session';
  stop: () => void;
  /** done 落定、结果记下之后完成。 */
  settled: Promise<void>;
  log?: string;
  tail: string;
}

const tasks = new Map<string, BackgroundTask>();
const TAIL_CHARS = 4000;
const NOTICE_LINES = 20;
const OUTPUT_LIMIT = 50 * 1024;
const EXIT_GRACE_MS = 100;

let logDirectory: string | undefined;
/** 上次运行留下的日志没有对应的任务，第一次用到时清掉。 */
function logDir() {
  if (!logDirectory) {
    logDirectory = join(app.getPath('userData'), 'background-tasks');
    rmSync(logDirectory, { recursive: true, force: true });
    mkdirSync(logDirectory, { recursive: true });
  }
  return logDirectory;
}

/** 登记一个后台任务；done 落定后记下结果并投递通知。 */
export function trackTask(
  task: Omit<BackgroundTask, 'startedAt' | 'status' | 'tail' | 'settled'> & { tail?: string },
  done: Promise<TaskOutcome>,
) {
  const entry: BackgroundTask = {
    ...task,
    tail: task.tail ?? '',
    startedAt: Date.now(),
    status: 'running',
    settled: done
      .catch((error: unknown): TaskOutcome => ({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        if (entry.stoppedBy && outcome.status !== 'completed')
          outcome = { ...outcome, status: 'stopped' };
        Object.assign(entry, { status: outcome.status, outcome, finishedAt: Date.now() });
        // 父会话正在归档或删除：不投递，也不推快照（删除后会话已不存在）。
        if (entry.stoppedBy === 'session') return;
        publish(entry.parentId);
        void deliverTaskNotice(entry.parentId, notice(entry), entry.stoppedBy !== 'user').catch(
          (error: unknown) => console.error('后台任务通知投递失败', error),
        );
      }),
  };
  tasks.set(entry.id, entry);
  publish(entry.parentId);
}

export const taskRunning = (id: string) => tasks.get(id)?.status === 'running';

export function runningTasks(parentId: string): BackgroundTaskView[] {
  return [...tasks.values()]
    .filter((task) => task.parentId === parentId && task.status === 'running')
    .map(({ id, kind, label, startedAt }) => ({ id, kind, label, startedAt }));
}

export function stopUserTask(parentId: string, id: string) {
  ownTask(parentId, id);
  stopTask(id, 'user');
}

export function stopTask(id: string, by: 'user' | 'model' | 'session') {
  const task = tasks.get(id);
  if (task?.status !== 'running') return;
  task.stoppedBy ??= by;
  task.stop();
}

/** 归档、删除父会话时结束它的全部后台任务，不投递通知。 */
export function stopSessionTasks(parentId: string) {
  for (const task of tasks.values()) if (task.parentId === parentId) stopTask(task.id, 'session');
}

/** 退出应用：结束全部任务并等它们落定，远端的取消要赶在隧道关掉之前送到。 */
export async function stopAllTasks() {
  const running = [...tasks.values()].filter((task) => task.status === 'running');
  for (const task of running) stopTask(task.id, 'session');
  await Promise.all(running.map((task) => task.settled));
}

const statusText = (outcome: TaskOutcome) =>
  outcome.status === 'completed'
    ? '完成'
    : outcome.status === 'stopped'
      ? '已停止'
      : outcome.exitCode != null
        ? `失败（退出码 ${outcome.exitCode}）`
        : `失败${outcome.error ? `：${outcome.error}` : ''}`;

function notice(task: BackgroundTask): { text: string; details: TaskNoticeDetails } {
  const outcome = task.outcome!;
  const durationMs = task.finishedAt! - task.startedAt;
  const tail = task.tail.split('\n').slice(-NOTICE_LINES).join('\n').trimEnd();
  const lines = [
    `后台任务结束（taskId: ${task.id}）`,
    task.kind === 'bash'
      ? `来源：bash\n命令：${task.label}`
      : `来源：子 Agent\n任务：${task.label}`,
    `状态：${statusText(outcome)}`,
    `用时：${(durationMs / 1000).toFixed(1)} 秒`,
    ...(task.stoppedBy === 'user' ? ['用户在后台任务面板上手动停止了它。'] : []),
    task.kind === 'bash'
      ? tail
        ? `输出末尾：\n\`\`\`\n${tail}\n\`\`\``
        : '没有输出'
      : outcome.reply
        ? `最终回复：\n${outcome.reply}`
        : '没有最终回复',
  ];
  return {
    text: lines.join('\n'),
    details: {
      taskId: task.id,
      kind: task.kind,
      label: task.label,
      status: outcome.status,
      ...(outcome.exitCode != null ? { exitCode: outcome.exitCode } : {}),
      durationMs,
      noticeId: randomUUID(),
    },
  };
}

/** 结束进程树：Windows 用 taskkill /T，其余平台进程组（spawn 时 detached）。 */
function killTree(pid: number) {
  if (process.platform === 'win32') {
    const killer = spawn(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/F', '/T', '/PID', String(pid)],
      { stdio: 'ignore', windowsHide: true },
    );
    killer.once('error', () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // 进程已退出。
  }
}

/** 后台 bash 的执行端：signal 中止时连同它启动的子进程一起结束。 */
export type BashRunner = (
  command: string,
  options: { signal: AbortSignal; timeout?: number; onData: (chunk: Buffer) => void },
) => Promise<TaskOutcome>;

function localBash(
  cwd: string,
  shell: ReturnType<typeof getShellConfig>,
  commandPrefix: string | undefined,
): BashRunner {
  return (command, { signal, timeout, onData }) => {
    const script = commandPrefix ? `${commandPrefix}\n${command}` : command;
    const fromStdin = shell.commandTransport === 'stdin';
    const child = spawn(shell.shell, fromStdin ? shell.args : [...shell.args, script], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: [fromStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (fromStdin) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(script);
    }
    let timedOut = false;
    let finished = false;
    const forward = (chunk: Buffer) => {
      if (!finished) onData(chunk);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    const stop = () => child.pid && killTree(child.pid);
    signal.addEventListener('abort', stop, { once: true });
    const timer = timeout
      ? setTimeout(() => ((timedOut = true), stop()), timeout * 1000)
      : undefined;
    return new Promise<TaskOutcome>((resolve) => {
      let exitCode: number | null = null;
      let idle: NodeJS.Timeout | undefined;
      const finish = (outcome?: TaskOutcome) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(idle);
        signal.removeEventListener('abort', stop);
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (outcome) resolve(outcome);
        else if (timedOut) resolve({ status: 'failed', error: `超时（${timeout} 秒）` });
        else resolve({ status: exitCode === 0 ? 'completed' : 'failed', exitCode });
      };
      // 退出后管道可能还被不在进程树里的后代攥着（Windows 上 Git Bash 的后台进程），close 不会来：
      // 与 Pi 的 bash 一样，shell 退出后管道静默一小段时间就算结束。
      const settle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => finish(), EXIT_GRACE_MS);
      };
      child.once('error', (error) => finish({ status: 'failed', error: error.message }));
      child.once('exit', (code) => {
        exitCode = code;
        settle();
        child.stdout?.on('data', settle);
        child.stderr?.on('data', settle);
      });
      child.once('close', () => finish());
    });
  };
}

function startBash(
  parentId: string,
  command: string,
  timeout: number | undefined,
  run: BashRunner,
): string {
  const id = randomUUID();
  const log = join(logDir(), `${id}.log`);
  const file = createWriteStream(log);
  const abort = new AbortController();
  const onData = (chunk: Buffer) => {
    file.write(chunk);
    const task = tasks.get(id);
    if (task) task.tail = (task.tail + chunk.toString()).slice(-TAIL_CHARS);
  };
  trackTask(
    { id, parentId, kind: 'bash', label: command, stop: () => abort.abort(), log },
    run(command, { signal: abort.signal, timeout, onData }).finally(() => file.end()),
  );
  return id;
}

/** 日志从 offset 起读至多 OUTPUT_LIMIT 字节；没给 offset 且日志太长时只读末尾。 */
function readLog(log: string, offset: number | undefined) {
  const size = statSync(log).size;
  const start = Math.min(offset ?? Math.max(0, size - OUTPUT_LIMIT), size);
  const length = Math.min(OUTPUT_LIMIT, size - start);
  const buffer = Buffer.alloc(length);
  const fd = openSync(log, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return { text: buffer.toString(), start, end: start + length, size };
}

function ownTask(parentId: string, id: string): BackgroundTask {
  const task = tasks.get(id);
  if (task?.parentId !== parentId) throw new Error(`没有这个后台任务：${id}`);
  return task;
}

const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  details: undefined,
});

/** 同名覆盖 bash，加一个 background 参数；不带它时就是原来的 bash，远程会话里是远程版本。 */
export async function backgroundTools(
  parentId: string,
  cwd: string,
  shellPath: string,
  commandPrefix: string | undefined,
  target: RemoteTarget | null,
): Promise<ToolDefinition[]> {
  const pi = await loadPi();
  const bash = target
    ? pi.createBashToolDefinition(cwd, { operations: remoteOperations(target).bash })
    : pi.createBashToolDefinition(cwd, { shellPath, commandPrefix });
  const schema = bash.parameters as unknown as { properties: Record<string, unknown> };
  return [
    {
      ...bash,
      parameters: {
        ...schema,
        properties: {
          ...schema.properties,
          background: {
            type: 'boolean',
            description:
              'true 时在后台运行并立即返回 taskId，适合开发服务器、长时间构建等不必等它结束的命令。结束时你会自动收到通知；期间可用 task_output 查看输出、task_stop 停止。',
          },
        },
      } as unknown as ToolDefinition['parameters'],
      async execute(
        toolCallId,
        params: { command: string; timeout?: number; background?: boolean },
        signal,
        onUpdate,
        ctx,
      ) {
        if (!params.background) return bash.execute(toolCallId, params, signal, onUpdate, ctx);
        // 启动时才解析 shell，创建会话不依赖本机 bash。
        const run = target
          ? remoteBackgroundBash(target, cwd)
          : localBash(cwd, pi.getShellConfig(shellPath), commandPrefix);
        const id = startBash(parentId, params.command, params.timeout, run);
        return text(`已在后台运行（taskId: ${id}）。结束时会自动通知你，不需要轮询。`);
      },
    } as ToolDefinition,
    {
      name: 'task_output',
      label: 'task_output',
      description:
        '查看后台任务（后台 bash 或后台子 Agent）的状态与输出。bash 返回状态、退出码和一段输出：不给 offset 时从头读（输出太长时只读末尾），给 offset 时从这个字节位置读，用上次返回的 nextOffset 只看新增的输出。子 Agent 返回状态和最终回复。任务结束时你会自动收到通知，不需要轮询。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          offset: { type: 'number', description: '从日志的这个字节位置读起' },
        },
        required: ['taskId'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params: { taskId: string; offset?: number }) {
        const task = ownTask(parentId, params.taskId);
        const status = task.outcome ? statusText(task.outcome) : '运行中';
        if (task.kind === 'subagent')
          return text(
            [
              `状态：${status}`,
              ...(task.outcome?.reply ? [`最终回复：\n${task.outcome.reply}`] : []),
            ].join('\n'),
          );
        const output = readLog(task.log!, params.offset);
        return text(
          [
            `状态：${status}`,
            `输出（字节 ${output.start}–${output.end}，共 ${output.size}）：`,
            output.text || '（没有输出）',
            `nextOffset: ${output.end}`,
          ].join('\n'),
        );
      },
    },
    {
      name: 'task_stop',
      label: 'task_stop',
      description: '停止一个后台任务：bash 连同它启动的子进程一起结束，子 Agent 中止当前这一轮。',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params: { taskId: string }) {
        const task = ownTask(parentId, params.taskId);
        if (task.status !== 'running') return text(`任务已经结束：${statusText(task.outcome!)}`);
        stopTask(task.id, 'model');
        return text('已停止。');
      },
    },
  ];
}
