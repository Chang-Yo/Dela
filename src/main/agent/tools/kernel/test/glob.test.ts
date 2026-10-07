// Glob：模式转正则的分支覆盖与目录遍历（** 跨目录、默认跳过 node_modules/.git、
// 相对路径返回、mtime 倒序）。
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globToRegExp, globTool } from '../glob';

describe('globToRegExp', () => {
  it('**/ 跨目录，* 单层不跨目录', () => {
    expect(globToRegExp('**/*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/deep/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false);
  });
  it('? 单字符与 [abc] 字符类', () => {
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('a?c').test('ac')).toBe(false);
    expect(globToRegExp('a[bc]d').test('abd')).toBe(true);
    expect(globToRegExp('a[bc]d').test('add')).toBe(false);
  });
  it('{a,b} 交替与元字符转义', () => {
    expect(globToRegExp('src/{ts,js}/x').test('src/ts/x')).toBe(true);
    expect(globToRegExp('src/{ts,js}/x').test('src/py/x')).toBe(false);
    expect(globToRegExp('a.b+c').test('a.b+c')).toBe(true);
    expect(globToRegExp('a.b+c').test('axb+c')).toBe(false);
  });
  it('未闭合的 [ 与 { 按字面量处理', () => {
    expect(globToRegExp('a[b').test('a[b')).toBe(true);
    expect(globToRegExp('a{b').test('a{b')).toBe(true);
  });
});

describe('globTool', () => {
  const root = mkdtempSync(join(tmpdir(), 'dela-glob-'));
  const file = (...parts: string[]) => {
    const path = join(root, ...parts);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'x');
    return path;
  };
  file('readme.md');
  file('src', 'main.ts');
  file('src', 'deep', 'util.ts');
  file('node_modules', 'dep', 'index.js');
  // mtime 倒序：util.ts 最新。
  const now = Date.now() / 1000;
  utimesSync(join(root, 'readme.md'), now - 3000, now - 3000);
  utimesSync(join(root, 'src', 'main.ts'), now - 2000, now - 2000);
  utimesSync(join(root, 'src', 'deep', 'util.ts'), now, now);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('** 模式跨目录返回相对路径，跳过 node_modules，按 mtime 倒序', () => {
    const result = globTool.execute({ pattern: '**/*.ts' }, { cwd: root }) as {
      files: string[];
    };
    expect(result.files).toEqual(['src/deep/util.ts', 'src/main.ts']);
  });

  it('单层 * 不进子目录；绝对 path 起点生效', () => {
    const result = globTool.execute({ pattern: '*.md', path: root }, {}) as { files: string[] };
    expect(result.files).toEqual(['readme.md']);
  });

  it('起点不是目录时报 INVALID_INPUT', () => {
    expect(() => globTool.execute({ pattern: '*', path: join(root, 'readme.md') }, {})).toThrow(
      '不是目录',
    );
  });
});
