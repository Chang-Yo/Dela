// 远程会话的后台任务：bash 同名覆盖后，前台仍是远程版本，后台换成 helper 任务。
// 停止走 helper 的显式取消，退出应用时要等 helper 报回结束；真机行为由 pnpm test:remote 覆盖。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { HelperExecOptions, HelperExecResult } from '../helper';
import type { TaskNotice } from '../../agent/session';

const root = mkdtempSync(join(tmpdir(), 'dela-remote-tasks-'));
const helper = vi.hoisted(() => ({
  execs: [] as {
    command: string;
    options: HelperExecOptions;
    finish: (result: HelperExecResult) => void;
  }[],
  cancelled: [] as string[],
}));
const delivered = vi.hoisted(() => [] as TaskNotice[]);
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false, getAppPath: () => root },
}));
vi.mock('../helper', () => ({
  helperSession: () => ({
    exec: (command: string, options: HelperExecOptions) =>
      new Promise<HelperExecResult>((finish) => helper.execs.push({ command, options, finish })),
    async cancelTask(id: string) {
      helper.cancelled.push(id);
      const exec = helper.execs.find(({ options }) => options.id === id);
      setTimeout(() => exec?.finish({ code: -1, state: 'cancelled', lost: 0 }), 50);
    },
  }),
}));
vi.mock('../watch', () => ({ syncRemoteWatch: () => {} }));
vi.mock('../../agent/session', () => ({
  publish: () => {},
  deliverTaskNotice: async (_parentId: string, notice: TaskNotice) => {
    delivered.push(notice);
  },
}));

import { backgroundTools, stopAllTasks } from '../../agent/tasks';

const cwd = '/root/proj';
let tools: ToolDefinition[];
const call = (name: string, params: object) =>
  tools
    .find((tool) => tool.name === name)!
    .execute('call', params as never, undefined, undefined, undefined as never);
const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((block) => block.text ?? '').join('');
const lastExec = async () => {
  await vi.waitFor(() => expect(helper.execs.length).toBeGreaterThan(0));
  return helper.execs.at(-1)!;
};
const start = async (command: string) =>
  /taskId: ([\w-]+)/.exec(textOf(await call('bash', { command, background: true })))![1]!;

beforeEach(async () => {
  helper.execs.length = 0;
  helper.cancelled.length = 0;
  delivered.length = 0;
  tools = await backgroundTools('parent', cwd, 'bash', undefined, {
    host: 'root@10.0.0.5',
    keyPath: null,
  });
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

it('不带 background 时仍是远程 bash：命令交给 helper，不在本机执行', async () => {
  const pending = call('bash', { command: 'uname -s' });
  const exec = await lastExec();
  expect(exec).toMatchObject({ command: 'uname -s', options: { cwd } });
  exec.options.onData!(Buffer.from('Linux\n'));
  exec.finish({ code: 0, state: 'exited', lost: 0 });
  expect(textOf(await pending)).toContain('Linux');
});

it('后台 bash 是 helper 任务：输出进日志，退出码映射成任务结果', async () => {
  const taskId = await start('make build');
  const exec = await lastExec();
  expect(exec.options).toMatchObject({ cwd, id: expect.any(String) });
  exec.options.onData!(Buffer.from('编译失败\n'));
  exec.finish({ code: 2, state: 'exited', lost: 0 });
  await vi.waitFor(() => expect(delivered).toHaveLength(1));
  expect(delivered[0]!.details).toMatchObject({
    taskId,
    kind: 'bash',
    status: 'failed',
    exitCode: 2,
  });
  expect(delivered[0]!.text).toContain('编译失败');
  expect(textOf(await call('task_output', { taskId }))).toContain('编译失败');
});

it('task_stop 用同一个任务 id 让 helper 取消，记为停止', async () => {
  const taskId = await start('pnpm dev');
  const exec = await lastExec();
  expect(textOf(await call('task_stop', { taskId }))).toContain('已停止');
  expect(helper.cancelled).toEqual([exec.options.id]);
  await vi.waitFor(() => expect(delivered).toHaveLength(1));
  expect(delivered[0]!.details.status).toBe('stopped');
});

it('退出应用时等 helper 报回取消后才返回，且不投递通知', async () => {
  await start('pnpm dev');
  const exec = await lastExec();
  let settled = false;
  const stopping = stopAllTasks().then(() => (settled = true));
  expect(helper.cancelled).toEqual([exec.options.id]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  await stopping;
  expect(delivered).toHaveLength(0);
});
