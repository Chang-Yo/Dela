// shell 工具的命令桥与长任务生命周期：dela 命令经本地 HTTP 桥复用业务工具（help /
// 参数校验 / 错误传递），长命令以 taskId 让出、shell_poll 续读、shell_cancel 停止。
// Windows 用真实 PowerShell（打包后同一入口）；其他平台用系统 sh。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executeDomainCommand, startDomainBridge } from '../commands';
import { cancelShellJobs, shellCancelTool, shellPollTool, shellTool } from './shell';
import type { ToolContext } from '../shared';

const directory = () => join(tmpdir(), `dela-shell-test-${runId}`);

// 业务命令桥不依赖真实校园登录：注册一个只读探针命令验证全链。
vi.mock('../canvas', async () => {
  const { z } = await import('zod');
  const { tool } = await import('../shared');
  return {
    canvasTools: {
      probe: tool(
        '测试探针',
        z.object({ echo: z.string() }).strict(),
        ({ echo }: { echo: string }) => ({ echoed: echo }),
      ),
    },
  };
});
vi.mock('../mail', () => ({ mailTools: {} }));
vi.mock('../shuiyuan', () => ({ shuiyuanTools: {} }));
vi.mock('../timetable', () => ({ timetableTools: {} }));
vi.mock('../todo', () => ({ todoTools: {} }));
vi.mock('../workspace', () => ({ workspaceTools: {} }));

let runId: string;
beforeEach(() => {
  runId = randomUUID().slice(0, 8);
});
afterEach(() => {
  cancelShellJobs();
  // kill 经 taskkill 异步生效：进程退出前 Windows 拒绝删除其工作目录，重试吸收该窗口。
  rmSync(directory(), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('命令桥', () => {
  it('help 列出命令与 JSON Schema，单命令查询只返回该命令', async () => {
    const all = (await executeDomainCommand('help', {})) as { name: string }[];
    expect(all.map(({ name }) => name)).toContain('probe');
    const single = (await executeDomainCommand('help', { command: 'probe' })) as {
      name: string;
    }[];
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ name: 'probe', description: '测试探针' });
  });

  it('执行域命令并传 ToolContext；未知命令与非法参数明确报错', async () => {
    await expect(executeDomainCommand('probe', { echo: '你好' })).resolves.toEqual({
      echoed: '你好',
    });
    await expect(executeDomainCommand('no_such', {})).rejects.toThrow('命令不存在');
    await expect(executeDomainCommand('probe', {})).rejects.toThrow();
    // abort 信号经桥传入：取消后命令拒绝执行。
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeDomainCommand('probe', { echo: 'x' }, { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('HTTP 桥校验 Bearer token 与请求形状', async () => {
    const bridge = await startDomainBridge({});
    try {
      const response = await fetch(bridge.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'probe', input: { echo: '桥' } }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, result: { echoed: '桥' } });
      // 错误的 token 拒绝；GET 与其他路径拒绝。
      const denied = await fetch(bridge.url, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
        body: '{}',
      });
      expect(denied.status).toBe(403);
      expect((await fetch(bridge.url, { method: 'GET' })).status).toBe(403);
    } finally {
      bridge.close();
    }
  });
});

const run = (
  command: string,
  context: { cwd: string; signal?: AbortSignal; onUpdate?: ToolContext['onUpdate'] } = {
    cwd: directory(),
  },
  yieldMs = 15000,
) => shellTool.execute({ command, cwd: context.cwd, yieldMs }, context);

describe('shell 工具', () => {
  beforeEach(() => {
    // shellTool 的 cwd 需已存在。
    mkdirSync(directory(), { recursive: true });
  });

  it('执行命令并收集输出（Windows PowerShell / POSIX sh 同一契约）', async () => {
    writeFileSync(join(directory(), 'note.md'), 'hello');
    const result = (await run(
      process.platform === 'win32'
        ? 'Get-Content note.md; dela probe \'{"echo":"命令"}\''
        : 'cat note.md; dela probe \'{"echo":"命令"}\'',
    )) as { running: boolean; exitCode: number | null; output: string };
    expect(result.running).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello');
    // dela 命令结果以 JSON 回显。
    expect(result.output).toContain('命令');
  });

  it('命令失败时保留输出与非零退出码', async () => {
    const result = (await run(
      process.platform === 'win32' ? 'Write-Output before; throw 失败' : 'echo before; exit 3',
    )) as { exitCode: number | null; output: string };
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('before');
  });

  it('长任务返回 taskId 让出，shell_poll 读到新输出，完成后回收', async () => {
    const result = (await run(
      process.platform === 'win32'
        ? 'Write-Output first; Start-Sleep -Seconds 3; Write-Output second'
        : 'echo first; sleep 3; echo second',
      { cwd: directory() },
      500,
    )) as { taskId: string; running: boolean; output: string };
    expect(result.running).toBe(true);
    const poll = (await shellPollTool.execute(
      { taskId: result.taskId, waitMs: 15000 },
      {
        cwd: directory(),
      },
    )) as { running: boolean; exitCode: number | null; output: string };
    expect(poll.running).toBe(false);
    expect(poll.exitCode).toBe(0);
    // 增量输出落在首次让出或后续轮询之一（Shell 冷启动快慢决定），二者合计必含全部内容。
    expect(result.output + poll.output).toContain('first');
    expect(result.output + poll.output).toContain('second');
    // 完成的任务不可再轮询。
    await expect(
      shellPollTool.execute({ taskId: result.taskId }, { cwd: directory() }),
    ).rejects.toThrow('不存在');
  }, 20000);

  it('shell_cancel 停止任务并保留已输出内容；输出同时落盘', async () => {
    let seen = '';
    const result = (await run(
      process.platform === 'win32'
        ? 'Write-Output early; Start-Sleep -Seconds 30'
        : 'echo early; sleep 30',
      // onUpdate 在输出到达时推送（250ms 节流）：等 early 真实输出后再取消，不赌固定等待。
      {
        cwd: directory(),
        onUpdate: (update) => {
          seen += String((update as { result?: { output?: string } }).result?.output ?? '');
        },
      },
      500,
    )) as { taskId: string; outputPath: string; output: string };
    await vi.waitFor(() => expect(seen).toContain('early'), { timeout: 15000 });
    const cancelled = (await shellCancelTool.execute(
      { taskId: result.taskId },
      {
        cwd: directory(),
      },
    )) as { running: boolean; output: string };
    expect(cancelled.running).toBe(false);
    expect(cancelled.output).toContain('early');
    expect(readFileSync(result.outputPath, 'utf8')).toContain('early');
  }, 25000);

  it('运行 abort 时同 signal 的任务被停止并清理', async () => {
    const controller = new AbortController();
    const result = (await run(
      process.platform === 'win32'
        ? 'Write-Output go; Start-Sleep -Seconds 30'
        : 'echo go; sleep 30',
      { cwd: directory(), signal: controller.signal },
      500,
    )) as { taskId: string; running: boolean };
    expect(result.running).toBe(true);
    controller.abort();
    cancelShellJobs(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      shellPollTool.execute({ taskId: result.taskId, waitMs: 100 }, { cwd: directory() }),
    ).rejects.toThrow('不存在');
  }, 20000);
});
