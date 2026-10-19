// MCP 页签纯逻辑测试：args/env 文本解析、表单校验、编辑补丁与状态徽标映射（通道经 window.dela.capability，由主进程实现）。
import { describe, expect, it } from 'vitest';
import {
  mcpStatusBadge,
  mcpUpdatePatch,
  parseArgsText,
  parseEnvText,
  parseMcpForm,
} from './mcp-logic';

describe('parseArgsText', () => {
  it('每行一个参数：去空白、忽略空行', () => {
    expect(parseArgsText('--yes\n  @scope/server  \n\n--port 8080\n')).toEqual([
      '--yes',
      '@scope/server',
      '--port 8080',
    ]);
  });
});

describe('parseEnvText', () => {
  it('每行 KEY=VALUE，允许空值与空行', () => {
    expect(parseEnvText('A=1\nB=\n\n C = 2 ')).toEqual({
      env: { A: '1', B: '', C: '2' },
      error: null,
    });
  });

  it('重复键以后一行为准', () => {
    expect(parseEnvText('A=1\nA=2')).toEqual({ env: { A: '2' }, error: null });
  });

  it('缺 = 的行报错并指明行号', () => {
    const result = parseEnvText('A=1\nBAD\nC=3');
    expect(result.error).toBe('环境变量第 2 行应为 KEY=VALUE 格式');
  });

  it('空键（= 开头或 KEY 为空白）报错', () => {
    expect(parseEnvText('=1').error).toBe('环境变量第 1 行应为 KEY=VALUE 格式');
    expect(parseEnvText(' =1').error).toBe('环境变量第 1 行应为 KEY=VALUE 格式');
  });

  it('值里保留后续的 = （以第一个 = 分割）', () => {
    expect(parseEnvText('CONN=a=b')).toEqual({ env: { CONN: 'a=b' }, error: null });
  });
});

describe('parseMcpForm', () => {
  const base = { command: 'npx', argsText: '-y\nserver', envText: 'KEY=1' };

  it('通过时返回去空白后的各字段', () => {
    expect(
      parseMcpForm(
        { name: ' weather ', argsText: '', envText: '', command: ' npx ' },
        {
          commandRequired: true,
        },
      ),
    ).toEqual({ ok: true, name: 'weather', command: 'npx', args: [], env: {} });
    expect(parseMcpForm({ name: 'weather', ...base }, { commandRequired: true })).toEqual({
      ok: true,
      name: 'weather',
      command: 'npx',
      args: ['-y', 'server'],
      env: { KEY: '1' },
    });
  });

  it('名称必填且不含空白', () => {
    expect(parseMcpForm({ name: '  ', ...base }, { commandRequired: true })).toEqual({
      ok: false,
      error: '名称不能为空',
    });
    expect(parseMcpForm({ name: 'my server', ...base }, { commandRequired: true })).toEqual({
      ok: false,
      error: '名称不能包含空格',
    });
    expect(parseMcpForm({ name: 'my\tserver', ...base }, { commandRequired: true })).toEqual({
      ok: false,
      error: '名称不能包含空格',
    });
  });

  it('command：新建必填，编辑可留空（保持原值）', () => {
    expect(
      parseMcpForm(
        { name: 's', command: ' ', argsText: '', envText: '' },
        { commandRequired: true },
      ),
    ).toEqual({ ok: false, error: 'command 不能为空' });
    expect(
      parseMcpForm(
        { name: 's', command: '', argsText: '', envText: '' },
        { commandRequired: false },
      ),
    ).toEqual({ ok: true, name: 's', command: '', args: [], env: {} });
  });

  it('env 格式错误直接透传给表单', () => {
    const result = parseMcpForm(
      { name: 's', command: 'npx', argsText: '', envText: 'BAD' },
      {
        commandRequired: true,
      },
    );
    expect(result).toEqual({ ok: false, error: '环境变量第 1 行应为 KEY=VALUE 格式' });
  });
});

describe('mcpUpdatePatch', () => {
  it('留空的 command/args/env 不进补丁（保持原值）', () => {
    expect(mcpUpdatePatch({ name: 's', command: '', args: [], env: {} })).toEqual({ name: 's' });
  });

  it('填写过的字段进入补丁', () => {
    expect(mcpUpdatePatch({ name: 's', command: 'node', args: ['a.js'], env: { X: '1' } })).toEqual(
      { name: 's', command: 'node', args: ['a.js'], env: { X: '1' } },
    );
  });
});

describe('mcpStatusBadge', () => {
  it('connecting 转圈，connected 绿点带工具数，disconnected 灰点，error 红点', () => {
    expect(mcpStatusBadge('connecting', null)).toEqual({
      label: '连接中',
      dotClass: 'text-muted-foreground',
      spin: true,
    });
    expect(mcpStatusBadge('connected', 3).label).toBe('已连接 · 3 个工具');
    expect(mcpStatusBadge('connected', 3).dotClass).toBe('bg-success');
    expect(mcpStatusBadge('connected', null).label).toBe('已连接');
    expect(mcpStatusBadge('disconnected', null)).toEqual({
      label: '未连接',
      dotClass: 'bg-muted-foreground/40',
      spin: false,
    });
    expect(mcpStatusBadge('error', null)).toEqual({
      label: '连接失败',
      dotClass: 'bg-destructive',
      spin: false,
    });
  });
});
