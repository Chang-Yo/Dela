import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { runCli, splitArgv } from '../bridge';
import type { DomainEntry } from '../bridge';

const save = {
  description: '新建或修改个人待办（本地写）。',
  schema: z.object({ title: z.string().min(1), completed: z.boolean().optional() }).strict(),
  execute: vi.fn(),
};
const query = {
  description: '查询个人待办。',
  schema: z.object({ query: z.string().default('') }).strict(),
  execute: vi.fn(),
};
const domains: Record<string, DomainEntry> = {
  todo: { description: '待办与作业', commands: { save, query } },
  mail: { description: '邮件', commands: {} },
};

type Execute = (name: string, input: unknown) => Promise<unknown>;
const run = (argv: string[], execute: Execute = async () => ({ ok: 1 })) =>
  runCli(argv, { domains, execute });

describe('子命令解析', () => {
  it('域 + 命令解析成执行与参数', async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const result = await run(['todo', 'save', '--title', '交作业', '--completed'], execute);
    expect(execute).toHaveBeenCalledWith('save', { title: '交作业', completed: true });
    expect(result).toEqual({ status: 200, body: '{"ok":true,"result":{"saved":true}}' });
  });

  it('help 给用法与逐参数说明', async () => {
    const overview = await run([]);
    expect(overview.body).toContain('用法：dela <域> <命令> [参数]');
    expect(overview.body).toContain('todo  待办与作业');
    const single = await run(['help', 'todo', 'save']);
    expect(single.body).toContain('用法：dela todo save [参数]');
    expect(single.body).toContain('--title 文本');
    const inline = await run(['todo', 'save', '--help']);
    expect(inline.body).toContain('--completed');
    const domain = await run(['todo']);
    expect(domain.body).toContain('dela todo save');
  });

  it('命令不存在时报出输入过的名字', async () => {
    const result = await run(['todo', 'nope']);
    expect(result.status).toBe(404);
    expect(result.body).toContain('命令不存在：todo nope');
  });

  it('参数错误直接返回，不执行命令', async () => {
    const execute = vi.fn(async () => ({}));
    const missing = await run(['todo', 'save'], execute);
    expect(missing).toEqual({ status: 400, body: '{"ok":false,"error":"缺少必填参数 --title"}' });
    const unknown = await run(['todo', 'save', '--title', 'x', '--nope', 'y'], execute);
    expect(unknown.body).toContain('未知参数 --nope');
    expect(execute).not.toHaveBeenCalled();
  });

  it('命令自身报错时带出原因', async () => {
    const result = await run(['todo', 'save', '--title', 'x'], async () => {
      throw new Error('待办不存在');
    });
    expect(result).toEqual({ status: 500, body: '{"ok":false,"error":"待办不存在"}' });
  });

  it('NUL 分隔的请求体还原成参数数组', () => {
    expect(splitArgv(Buffer.from('todo\0save\0--title\0交作业\0', 'utf8'))).toEqual([
      'todo',
      'save',
      '--title',
      '交作业',
    ]);
    expect(splitArgv(Buffer.from('help\0', 'utf8'))).toEqual(['help']);
    expect(splitArgv(Buffer.alloc(0))).toEqual([]);
  });
});
