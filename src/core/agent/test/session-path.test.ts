import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveSessionFile } from '../session-path';

const root = mkdtempSync(join(tmpdir(), 'dela-session-file-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const cwd = join(root, 'project');
mkdirSync(cwd, { recursive: true });
writeFileSync(join(cwd, 'a.md'), 'x');
writeFileSync(join(root, 'desktop.html'), 'x');

describe('resolveSessionFile', () => {
  it('接受会话目录内与会话目录外的已存在文件', () => {
    expect(resolveSessionFile(cwd, 'a.md')).toBe(resolve(cwd, 'a.md'));
    expect(resolveSessionFile(cwd, join(root, 'desktop.html'))).toBe(resolve(root, 'desktop.html'));
  });

  it('不存在的路径明确报错', () => {
    expect(() => resolveSessionFile(cwd, 'missing.md')).toThrow('文件不存在');
  });
});
