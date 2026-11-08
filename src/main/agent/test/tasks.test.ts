// 后台 bash：真实进程，父会话的通知投递换成记录。成功、失败、长输出、停止（连同子进程），
// 以及用户手动停止只追加不唤醒、归档删除时不投递。
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TaskNotice } from '../session';

const root = mkdtempSync(join(tmpdir(), 'dela-tasks-'));
const delivered = vi.hoisted(() => [] as { parentId: string; notice: TaskNotice; wake: boolean }[]);
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false, getAppPath: () => root },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../session', () => ({
  publish: () => {},
  deliverTaskNotice: async (parentId: string, notice: TaskNotice, wake: boolean) => {
    delivered.push({ parentId, notice, wake });
  },
}));

import { locateBash } from '../../terminal';
import { backgroundTools, stopSessionTasks, stopTask } from '../tasks';

const shell = locateBash();
let tools: ToolDefinition[];
const tool = (name: string) => tools.find((item) => item.name === name)!;
const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((block) => block.text ?? '').join('');
const call = async (name: string, params: object) =>
  textOf(
    await tool(name).execute('call', params as never, undefined, undefined, undefined as never),
  );
const start = async (command: string) =>
  /taskId: ([\w-]+)/.exec(await call('bash', { command, background: true }))![1]!;
const noticeOf = async (taskId: string) => {
  await vi.waitFor(
    () => expect(delivered.some(({ notice }) => notice.details.taskId === taskId)).toBe(true),
    { timeout: 10_000 },
  );
  return delivered.find(({ notice }) => notice.details.taskId === taskId)!;
};

beforeEach(async () => {
  delivered.length = 0;
  tools = await backgroundTools('parent', root, shell, undefined, null);
});

afterAll(() => {
  stopSessionTasks('parent');
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it('不带 background 时就是内置 bash；带上时立即返回，结束后投递带输出末尾的通知', async () => {
  expect(await call('bash', { command: 'echo 前台' })).toContain('前台');
  const taskId = await start('sleep 0.2; echo 后台完成');
  expect(delivered).toHaveLength(0);
  const { parentId, notice, wake } = await noticeOf(taskId);
  expect(parentId).toBe('parent');
  expect(wake).toBe(true);
  expect(notice.details).toMatchObject({
    kind: 'bash',
    status: 'completed',
    label: 'sleep 0.2; echo 后台完成',
  });
  expect(notice.text).toContain('后台完成');
  expect(await call('task_output', { taskId })).toContain('状态：完成');
});

it('退出码非零记为失败，通知里带退出码', async () => {
  const taskId = await start('echo 出错了; exit 3');
  const { notice } = await noticeOf(taskId);
  expect(notice.details).toMatchObject({ status: 'failed', exitCode: 3 });
  expect(notice.text).toContain('退出码 3');
  expect(notice.text).toContain('出错了');
});

it('长输出完整写进日志：通知只带末尾几行，task_output 按 offset 分段读', async () => {
  const taskId = await start('seq 1 100000');
  const { notice } = await noticeOf(taskId);
  expect(notice.text).toContain('\n100000\n');
  expect(notice.text).not.toContain('\n99900\n');

  const tail = await call('task_output', { taskId });
  const size = Number(/共 (\d+)/.exec(tail)![1]);
  expect(size).toBeGreaterThan(500_000);
  expect(tail).toContain('100000');
  expect(tail).toContain(`nextOffset: ${size}`);

  const head = await call('task_output', { taskId, offset: 0 });
  expect(head).toContain('输出（字节 0–51200');
  expect(head).toMatch(/：\n1\n2\n3\n/);
  expect(await call('task_output', { taskId, offset: size })).toContain('（没有输出）');
});

it('task_stop 连同子进程一起结束，记为停止并照常投递', async () => {
  // 后台子进程活下来的话，1 秒后会写出标记文件。
  const marker = join(root, 'survived');
  const taskId = await start(`(sleep 1; echo > '${marker}') & sleep 30; wait`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await call('task_stop', { taskId })).toContain('已停止');
  const { notice, wake } = await noticeOf(taskId);
  expect(notice.details.status).toBe('stopped');
  expect(wake).toBe(true);
  expect(await call('task_stop', { taskId })).toContain('任务已经结束');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(existsSync(marker)).toBe(false);
}, 15_000);

it('用户在面板上手动停止只追加通知、不唤醒；归档删除时结束任务且不投递', async () => {
  const manual = await start('sleep 30');
  stopTask(manual, 'user');
  const { notice, wake } = await noticeOf(manual);
  expect(wake).toBe(false);
  expect(notice.text).toContain('手动停止');

  const silent = await start('sleep 30');
  stopSessionTasks('parent');
  await vi.waitFor(
    async () => expect(await call('task_output', { taskId: silent })).toContain('已停止'),
    {
      timeout: 10_000,
    },
  );
  expect(delivered.some(({ notice }) => notice.details.taskId === silent)).toBe(false);
});

it('别的会话的任务查不到', async () => {
  const taskId = await start('echo 我的');
  const others = await backgroundTools('other', root, shell, undefined, null);
  await expect(
    others
      .find((item) => item.name === 'task_output')!
      .execute('call', { taskId } as never, undefined, undefined, undefined as never),
  ).rejects.toThrow('没有这个后台任务');
  await noticeOf(taskId);
});

it('只创建工具时不解析 shell，真正跑后台 bash 才要求本机存在 bash', async () => {
  const missing = await backgroundTools(
    'no-shell',
    root,
    join(root, 'missing-bash'),
    undefined,
    null,
  );
  await expect(
    missing
      .find((item) => item.name === 'bash')!
      .execute(
        'call',
        { command: 'echo 后台', background: true } as never,
        undefined,
        undefined,
        undefined as never,
      ),
  ).rejects.toThrow();
});
