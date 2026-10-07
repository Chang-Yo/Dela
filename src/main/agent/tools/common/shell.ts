import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { tool, type ToolContext } from '../shared';
import { POWERSHELL_COMMAND_BRIDGE, POSIX_COMMAND_BRIDGE, startDomainBridge } from '../commands';
import { resolveToolPath } from './files';

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
  if (process.platform === 'win32')
    spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
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
  if (!job || job.signal !== context.signal) throw new Error('Shell 任务不存在或不属于当前运行');
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

export const shellTool = tool(
  "执行本地命令。Windows 使用 PowerShell，其他平台使用系统 Shell。cwd 默认当前项目目录。输出保留完整文件；长任务返回 taskId，用 shell_poll 查看、shell_cancel 停止。可用 dela <命令> '<JSON>' 调用校园业务，dela help 查询参数。",
  z
    .object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      yieldMs: z.number().int().min(1).max(30000).default(10000),
      timeoutMs: z.number().int().min(1).max(2_147_483_647).optional(),
    })
    .strict(),
  async ({ command, cwd: input, yieldMs, timeoutMs }, context) => {
    context.signal?.throwIfAborted();
    const cwd = input ? resolveToolPath(input, context) : context.cwd;
    if (!cwd) throw new Error('请提供 Shell 工作目录');
    const bridge = await startDomainBridge(context);
    const directory = mkdtempSync(join(tmpdir(), 'dela-shell-'));
    const outputPath = join(directory, 'output.log');
    writeFileSync(outputPath, '');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
    );
    env.DELA_COMMAND_URL = bridge.url;
    env.DELA_COMMAND_TOKEN = bridge.token;
    const windows = process.platform === 'win32';
    const shell = windows ? 'powershell.exe' : process.env.SHELL || '/bin/sh';
    const script = windows
      ? `${POWERSHELL_COMMAND_BRIDGE}\n${command}`
      : `${POSIX_COMMAND_BRIDGE}\n${command}`;
    const args = windows
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(
            `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'\n${script}`,
            'utf16le',
          ).toString('base64'),
        ]
      : ['-c', script];
    const child = spawn(shell, args, {
      cwd,
      env,
      windowsHide: true,
      detached: !windows,
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
      append(error.message);
      finish(1);
    });
    child.once('close', finish);
    return collect(id, yieldMs, context);
  },
);

export const shellPollTool = tool(
  '读取当前运行的长 Shell 任务新输出；完成时返回退出码。',
  z
    .object({
      taskId: z.string().uuid(),
      waitMs: z.number().int().min(1).max(30000).default(10000),
    })
    .strict(),
  ({ taskId, waitMs }, context) => collect(taskId, waitMs, context),
);
export const shellCancelTool = tool(
  '停止当前运行的 Shell 任务及其子进程，返回任务至今的全部输出。',
  z.object({ taskId: z.string().uuid() }).strict(),
  async ({ taskId }, context) => {
    const job = jobs.get(taskId);
    if (!job || job.signal !== context.signal) throw new Error('Shell 任务不存在或不属于当前运行');
    job.cursor = 0;
    job.cancel();
    return collect(taskId, 1000, context);
  },
);
