import { describe, expect, it } from 'vitest';
import { createTwoFilesPatch } from 'diff';
import { diffStatOf, parseUnifiedPatch } from './diff';

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

describe('parseUnifiedPatch', () => {
  it('实际内容形同文件头时保留改动并正确递增后续行号', () => {
    const generated = createTwoFilesPatch(
      'a/test.txt',
      'b/test.txt',
      '-- old\nkeep\n',
      '++ new\nkeep\n',
    );
    expect(parseUnifiedPatch(generated).slice(1)).toEqual([
      { kind: 'del', oldLine: 1, newLine: null, text: '-- old' },
      { kind: 'add', oldLine: null, newLine: 1, text: '++ new' },
      { kind: 'context', oldLine: 2, newLine: 2, text: 'keep' },
    ]);
  });

  it('拆出行带双侧行号，分隔线、文件头与 No newline 标记不产出行', () => {
    const withSeparator = `===================================================================\n${patch}`;
    const rows = parseUnifiedPatch(withSeparator);
    expect(rows.map((row) => row.kind)).toEqual([
      'hunk',
      'context',
      'del',
      'add',
      'add',
      'hunk',
      'context',
      'del',
      'add',
    ]);
    expect(rows[0]).toMatchObject({ text: '@@ -1,3 +1,4 @@' });
    expect(rows[1]).toMatchObject({ kind: 'context', oldLine: 1, newLine: 1, text: '保留行' });
    expect(rows[2]).toMatchObject({ kind: 'del', oldLine: 2, newLine: null, text: '删除行' });
    expect(rows[3]).toMatchObject({ kind: 'add', oldLine: null, newLine: 2, text: '新增行' });
    // 第二个 hunk 从各自的行号继续。
    expect(rows.at(-1)).toMatchObject({ kind: 'add', oldLine: null, newLine: 12, text: '新值' });
    expect(rows[5]).toMatchObject({ kind: 'hunk', oldLine: null, newLine: null });
    expect(rows[6]).toMatchObject({ kind: 'context', oldLine: 10, newLine: 11 });
  });

  it('纯新增文件的旧侧行号为 null', () => {
    const rows = parseUnifiedPatch('--- /dev/null\n+++ b/new.py\n@@ -0,0 +1,1 @@\n+内容');
    expect(rows[1]).toMatchObject({ kind: 'add', oldLine: null, newLine: 1 });
  });

  it('结尾换行不产生多余的空行', () => {
    expect(parseUnifiedPatch('@@ -1,1 +1,1 @@\n-a\n+b\n')).toHaveLength(3);
  });
});
