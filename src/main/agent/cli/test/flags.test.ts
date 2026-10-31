import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {},
  app: { getPath: () => tmpdir(), isPackaged: false, getAppPath: () => tmpdir() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

import { mailTools } from '../../domain/mail';
import { todoTools } from '../../domain/todo';
import { workspaceTools } from '../../domain/workspace';
import { flagValue, flagsFromSchema, formatHelp, parseArgv } from '../flags';

const todoFlags = flagsFromSchema(todoTools.save_todo.schema)!;

/** 解析成功时返回经 schema 校验的 input，失败时直接抛出，避免测试里层层判空。 */
const parse = (argv: string[], flags = todoFlags) => {
  const result = parseArgv(argv, flags);
  if (!result.ok) throw new Error(result.error);
  return todoTools.save_todo.schema.parse(result.input);
};
const parseError = (argv: string[], flags = todoFlags) => {
  const result = parseArgv(argv, flags);
  return result.ok ? null : result.error;
};

describe('schema 转参数表', () => {
  it('顶层字段逐个变成 --flag，必填与可空都标出来', () => {
    expect(todoFlags.map((flag) => flag.name)).toEqual([
      '--id',
      '--title',
      '--notes',
      '--due-at',
      '--completed',
      '--calendar',
      '--color',
    ]);
    const title = todoFlags.find((flag) => flag.key === 'title')!;
    expect(title.required).toBe(true);
    expect(title.constraints).toBe('长度 1–200');
    const dueAt = todoFlags.find((flag) => flag.key === 'dueAt')!;
    expect(dueAt.kind).toBe('string');
    expect(dueAt.nullable).toBe(true);
    expect(dueAt.format).toBe('date-time');
    expect(flagValue(dueAt)).toBe('时间|null');
    expect(todoFlags.find((flag) => flag.key === 'color')!.enumValues).toContain('sage');
  });

  it('数组字段标成可重复，嵌套对象字段退化成 JSON', () => {
    const mail = flagsFromSchema(mailTools.prepare_email.schema)!;
    expect(mail.find((flag) => flag.key === 'to')!.kind).toBe('array');
    expect(flagValue(mail.find((flag) => flag.key === 'to')!)).toBe('值（重复给出）');
    const workspace = flagsFromSchema(workspaceTools.copy_file_to_project.schema)!;
    expect(workspace.find((flag) => flag.key === 'source')!.kind).toBe('json');
  });

  it('生成用法与逐参数说明', () => {
    const help = formatHelp('todo save', todoTools.save_todo.description, todoFlags);
    expect(help.split('\n')[2]).toBe('用法：dela todo save [参数]');
    expect(help).toContain('  --title 文本');
    expect(help).toContain('必填；长度 1–200');
    expect(help).toContain('  --color rose|peach|sand|sage|teal|blue|lilac|slate');
  });
});

describe('参数解析', () => {
  it('拼出命令能直接执行的 input', () => {
    expect(parse(['--title', '交作业', '--due-at', '2026-11-01T15:00:00Z'])).toEqual({
      title: '交作业',
      dueAt: '2026-11-01T15:00:00Z',
    });
  });

  it('开关、可空、枚举、数字各按约定处理', () => {
    expect(parse(['--title', 'x', '--completed'])).toEqual({ title: 'x', completed: true });
    expect(parse(['--title', 'x', '--no-completed'])).toEqual({ title: 'x', completed: false });
    expect(parse(['--title', 'x', '--due-at', 'null'])).toEqual({ title: 'x', dueAt: null });
    expect(parse(['--title', 'x', '--color', 'sage'])).toEqual({ title: 'x', color: 'sage' });
    expect(parse(['--title', 'x', '--color=sage'])).toEqual({ title: 'x', color: 'sage' });
  });

  it('数组参数重复给出，嵌套对象按 JSON 传入', () => {
    const mail = flagsFromSchema(mailTools.prepare_email.schema)!;
    const sent = parseArgv(
      ['--to', 'a@b.com', '--to', 'c@d.com', '--subject', '标题', '--text', '正文'],
      mail,
    );
    expect(sent).toEqual({
      ok: true,
      input: { to: ['a@b.com', 'c@d.com'], subject: '标题', text: '正文' },
    });
    const workspace = flagsFromSchema(workspaceTools.copy_file_to_project.schema)!;
    const copied = parseArgv(
      ['--source', '{"type":"canvas","id":"x"}', '--parent-id', 'w1'],
      workspace,
    );
    expect(copied).toEqual({
      ok: true,
      input: { source: { type: 'canvas', id: 'x' }, parentId: 'w1' },
    });
  });

  it('说清哪一步错了', () => {
    expect(parseError(['--title', 'x', '--nope', 'y'])).toEqual(
      '未知参数 --nope，可用：--id --title --notes --due-at --completed --calendar --color',
    );
    expect(parseError([])).toBe('缺少必填参数 --title');
    expect(parseError(['--title', 'x', '--color', 'pink'])).toBe(
      '--color 只能取 rose / peach / sand / sage / teal / blue / lilac / slate',
    );
    expect(parseError(['--title', 'x', '--completed=yes'])).toBe('--completed 是开关，不要带值');
    expect(parseError(['--title'])).toBe('--title 缺少取值');
    expect(parseError(['--title', 'x', '--color'])).toBe('--color 缺少取值');
  });
});
