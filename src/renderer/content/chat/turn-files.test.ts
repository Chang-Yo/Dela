import { describe, expect, it } from 'vitest';
import type { AgentToolResult } from '../../../shared/api';
import { basenameOf, collectTurnFiles, dirnameOf } from './turn-files';

const call = (name: 'write' | 'edit' | 'read', path?: string): AgentToolResult => ({
  id: `${name}-${path ?? 'x'}`,
  name,
  input: path === undefined ? {} : { path },
});

describe('collectTurnFiles', () => {
  it('按首次出现排序，同一文件合并计数', () => {
    expect(
      collectTurnFiles([
        { type: 'tools', results: [call('write', 'D:/p/a.md'), call('read', 'D:/p/b.md')] },
        { type: 'tools', results: [call('edit', 'D:/p/a.md'), call('write', 'D:/p/c.ts')] },
      ]),
    ).toEqual([
      { path: 'D:/p/a.md', kind: 'write', count: 2 },
      { path: 'D:/p/c.ts', kind: 'write', count: 1 },
    ]);
  });

  it('忽略没有路径的工具调用与纯文本消息', () => {
    expect(
      collectTurnFiles([
        { type: 'text', text: '说明' },
        { type: 'tools', results: [call('write'), call('read', 'D:/p/a.md')] },
      ]),
    ).toEqual([]);
  });
});

describe('路径展示', () => {
  it('同时兼容 Windows 与 POSIX 分隔符', () => {
    expect(basenameOf('D:/p/a.md')).toBe('a.md');
    expect(basenameOf('/home/u/a.md')).toBe('a.md');
    expect(dirnameOf('D:/p/a.md')).toBe('D:/p');
    expect(dirnameOf('/home/u/a.md')).toBe('/home/u');
  });
});
