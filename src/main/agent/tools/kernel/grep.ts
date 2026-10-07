import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { tool, toolError } from '../shared';
import { resolveToolPath } from './path';
import { globToRegExp } from './glob';

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);
const MAX_RESULTS = 200;
const MAX_FILES = 5000;
const MAX_LINE_LENGTH = 500;

export const grepTool = tool(
  '在文件内容中按正则搜索，返回 文件:行号:该行内容。pattern 是 JavaScript 正则表达式；glob 限定文件名（如 "*.ts"）；path 是搜索起点（默认当前工作目录）。默认跳过 node_modules、.git 与二进制文件。',
  z
    .object({
      pattern: z.string().trim().min(1).max(1000),
      path: z.string().trim().min(1).optional(),
      glob: z.string().trim().min(1).max(500).optional(),
      ignoreCase: z.boolean().default(false),
      maxResults: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  ({ pattern, path: input, glob, ignoreCase, maxResults }, context) => {
    const root = resolveToolPath(input ?? '.', context);
    if (!statSync(root).isDirectory()) throw toolError('INVALID_INPUT', `不是目录：${root}`);
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch (error) {
      throw toolError('INVALID_INPUT', `正则表达式无效：${(error as Error).message}`);
    }
    const nameFilter = glob ? globToRegExp(glob.replace(/\\/g, '/').split('/').pop()!) : null;
    const matches: { path: string; line: number; text: string }[] = [];
    let filesScanned = 0;
    let truncated = false;
    const walk = (directory: string) => {
      if (truncated || filesScanned >= MAX_FILES) return;
      let children;
      try {
        children = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (truncated) return;
        if (child.isSymbolicLink()) continue;
        const full = join(directory, child.name);
        if (child.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(child.name)) continue;
          walk(full);
        } else if (child.isFile()) {
          if (filesScanned >= MAX_FILES) {
            truncated = true;
            return;
          }
          filesScanned += 1;
          if (nameFilter && !nameFilter.test(child.name)) continue;
          const bytes = readFileSync(full);
          if (bytes.includes(0)) continue; // 二进制跳过
          const lines = bytes.toString('utf8').split('\n');
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            if (!regex.test(line)) continue;
            matches.push({
              path: relative(root, full).split(sep).join('/'),
              line: index + 1,
              text: line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line,
            });
            if (matches.length >= Math.min(maxResults, MAX_RESULTS)) {
              truncated = true;
              return;
            }
          }
        }
      }
    };
    walk(root);
    return {
      path: root,
      pattern,
      matches,
      filesScanned,
      truncated,
    };
  },
);
