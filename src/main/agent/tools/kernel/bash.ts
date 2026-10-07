import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { tool, type ToolContext } from '../shared';
import { COMMAND_BRIDGE, startDomainBridge } from '../commands';
import { resolveToolPath } from './path';

const jobs = new Map<
  string,
  {
    child: ChildProcess;
    signal?: AbortSignal;
    output: string;
    cursor: number;
    exitCode: number | null;
    done: boolean;
    outputPath: string;
    finished: Promise<void>;
    cancel: () => void;
  }
>();

function killProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

/** 定位 Git Bash（Windows 统一 shell）：常见安装位置探测；缺失时明确报错，
 *  不回退 PowerShell 或 PATH 上的 bash（可能是 WSL）。终端与本工具共用。 */
let bashExecutable: string | null | undefined;
export function locateBash(): string {
  if (bashExecutable !== undefined) return bashExecutable!;
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git\\bin\\bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git\\bin\\bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs\\Git\\bin\\bash.exe'),
  ].filter((path) => path && existsSync(path));
  bashExecutable =
    candidates[0] ??
    (() => {
      throw new Error(
        '未找到 Git Bash：请安装 Git for Windows（https://git-scm.com/download/win）后重试',
      );
    })();
  return bashExecutable;
}

export function cancelShellJobs(signal?: AbortSignal): void {
  for (const [id, job] of jobs)
    if (!signal || job.signal === signal) {
      if (!job.done) job.cancel();
      jobs.delete(id);
    }
}

async function collect(id: string, waitMs: number, context: ToolContext) {
  const job = jobs.get(id);
  if (!job || job.signal !== context.signal) throw new Error('任务不存在或不属于当前运行');
  let timer: NodeJS.Timeout | undefined;
  if (!job.done)
    await Promise.race([
      job.finished,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
  if (timer) clearTimeout(timer);
  const output = job.output.slice(job.cursor);
  job.cursor = job.output.length;
  const result = {
    taskId: id,
    running: !job.done,
    exitCode: job.exitCode,
    output: output.slice(-18000),
    truncated: output.length > 18000,
    outputPath: job.outputPath,
  };
  if (job.done) jobs.delete(id);
  return result;
}

const inputSchema = z
  .object({
    command: z.string().min(1).optional(),
    cwd: z.string().optional(),
    yieldMs: z.number().int().min(1).max(30000).default(10000),
    timeoutMs: z.number().int().min(1).max(2_147_483_647).optional(),
    taskId: z.string().uuid().optional(),
    waitMs: z.number().int().min(1).max(30000).default(10000),
    cancel: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Boolean(input.command ?? input.taskId), {
    message: 'command（执行命令）或 taskId（续读/停止长任务）必须提供其一',
  });

export const bashTool = tool(
  "在 Git Bash 中执行命令。cwd 默认当前项目目录；Windows 路径在命令内写作 /c/... 形式。长任务自动让出并返回 taskId：再调用本工具传 taskId 续读新输出（waitMs 控制等待），传 taskId + cancel 停止任务。可用 dela <命令> '<JSON>' 调用校园业务命令（课程、邮件、水源、课表、待办、工作区），dela help 查看命令清单与参数。",
  inputSchema,
  async (input, context) => {
    context.signal?.throwIfAborted();
    if (input.taskId) {
      if (input.cancel) {
        const job = jobs.get(input.taskId);
        if (!job || job.signal !== context.signal) throw new Error('任务不存在或不属于当前运行');
        job.cursor = 0;
        job.cancel();
        return collect(input.taskId, 1000, context);
      }
      return collect(input.taskId, input.waitMs, context);
    }
    const { command, cwd: inputCwd, yieldMs, timeoutMs } = input;
    const cwd = inputCwd ? resolveToolPath(inputCwd, context) : context.cwd;
    if (!cwd) throw new Error('请提供工作目录');
    const bridge = await startDomainBridge(context);
    const directory = mkdtempSync(join(tmpdir(), 'dela-bash-'));
    const outputPath = join(directory, 'output.log');
    writeFileSync(outputPath, '');
    const env = { ...process.env } as Record<string, string | undefined>;
    env.DELA_COMMAND_URL = bridge.url;
    env.DELA_COMMAND_TOKEN = bridge.token;
    const script = `${COMMAND_BRIDGE}\n${command}`;
    const child = spawn(locateBash(), ['-c', script], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const id = randomUUID();
    let done!: () => void;
    const job = {
      child,
      signal: context.signal,
      output: '',
      cursor: 0,
      exitCode: null as number | null,
      done: false,
      outputPath,
      finished: new Promise<void>((resolve) => {
        done = resolve;
      }),
      cancel: () => killProcessTree(child),
    };
    jobs.set(id, job);
    let updateTimer: NodeJS.Timeout | undefined;
    const append = (text: string) => {
      appendFileSync(outputPath, text);
      job.output += text;
      if (job.output.length > 1_000_000) {
        job.output = job.output.slice(-1_000_000);
        job.cursor = 0;
      }
      if (!updateTimer)
        updateTimer = setTimeout(() => {
          updateTimer = undefined;
          context.onUpdate?.({
            ok: true,
            result: {
              taskId: id,
              running: !job.done,
              output: job.output.slice(-18000),
              outputPath,
            },
          });
        }, 250);
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const abort = () => job.cancel();
    context.signal?.addEventListener('abort', abort, { once: true });
    if (context.signal?.aborted) abort();
    const timeout = timeoutMs
      ? setTimeout(() => {
          append('任务达到超时时间，已停止。\n');
          job.cancel();
        }, timeoutMs)
      : undefined;
    const finish = (code: number | null) => {
      if (job.done) return;
      job.done = true;
      job.exitCode = code;
      if (timeout) clearTimeout(timeout);
      if (updateTimer) clearTimeout(updateTimer);
      context.signal?.removeEventListener('abort', abort);
      bridge.close();
      done();
    };
    child.once('error', (error) => {
      append(
        error.message.includes('ENOENT')
          ? '未找到 bash：请安装 Git for Windows（https://git-scm.com/download/win）后重试。\n'
          : `${error.message}\n`,
      );
      finish(1);
    });
    child.once('close', finish);
    return collect(id, yieldMs, context);
  },
);
