import { describe, expect, it } from 'vitest';
import { diffStatOf } from '../protocol/diff';

const patch = [
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' 保留行',
  '-删除行',
  '+新增行',
  '+再增一行',
  '\\ No newline at end of file',
  '@@ -10,2 +11,2 @@',
  ' 上下文',
  '-旧值',
  '+新值',
  '',
].join('\n');

describe('diffStatOf', () => {
  it('只统计 hunk 内的增删行，文件头与上下文不计', () => {
    expect(diffStatOf(patch)).toEqual({ added: 3, deleted: 2 });
  });

  it('空 patch 与 null 返回 null，新增文件删除行为 0', () => {
    expect(diffStatOf(null)).toBeNull();
    expect(diffStatOf('')).toBeNull();
    expect(diffStatOf('--- /dev/null\n+++ b/new.py\n@@ -0,0 +1,2 @@\n+第一行\n+第二行')).toEqual({
      added: 2,
      deleted: 0,
    });
  });

  it('以 --- 开头的删除行不会被误判为文件头', () => {
    expect(diffStatOf('@@ -1,1 +1,1 @@\n---\n+---')).toEqual({ added: 1, deleted: 1 });
  });
});
