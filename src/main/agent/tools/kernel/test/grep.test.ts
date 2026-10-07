// Grep：正则匹配、ignoreCase、glob 文件名过滤、二进制与 node_modules 跳过、
// 无效正则报 INVALID_INPUT。
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepTool } from '../grep';

const root = mkdtempSync(join(tmpdir(), 'dela-grep-'));
const put = (relative: string, content: string | Buffer) => {
  const path = join(root, ...relative.split('/'));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};
put('a.ts', 'const alpha = 1;\nconst beta = 2;\n');
put('src/b.ts', 'const ALPHAupper = 3;\n');
put('notes.txt', 'alpha in text\n');
put('binary.bin', Buffer.from([0x61, 0x00, 0x62])); // 含 NUL：按二进制跳过
put('node_modules/dep.js', 'const alpha = 9;\n');

afterAll(() => rmSync(root, { recursive: true, force: true }));

function grep(input: Record<string, unknown>, cwd = root) {
  return grepTool.execute(input, { cwd }) as {
    matches: { path: string; line: number; text: string }[];
    filesScanned: number;
  };
}

describe('grepTool', () => {
  it('按正则匹配并返回 相对路径:行号:该行内容', () => {
    const result = grep({ pattern: 'alpha' });
    expect(result.matches).toContainEqual({ path: 'a.ts', line: 1, text: 'const alpha = 1;' });
    // 二进制与 node_modules 不参与。
    expect(result.matches.some((match) => match.path.startsWith('node_modules'))).toBe(false);
    expect(result.matches.some((match) => match.path === 'binary.bin')).toBe(false);
  });

  it('ignoreCase 时命中大小写变体', () => {
    const result = grep({ pattern: 'alpha', ignoreCase: true });
    expect(result.matches.some((match) => match.path === 'src/b.ts')).toBe(true);
  });

  it('glob 限定文件名后其余文件不扫描匹配', () => {
    const result = grep({ pattern: 'alpha', glob: '*.ts' });
    expect(result.matches.every((match) => match.path.endsWith('.ts'))).toBe(true);
    expect(result.matches.some((match) => match.path === 'notes.txt')).toBe(false);
  });

  it('无效正则报 INVALID_INPUT', () => {
    expect(() => grep({ pattern: '(' })).toThrow('正则表达式无效');
  });
});
