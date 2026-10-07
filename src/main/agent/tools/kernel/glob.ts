import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { tool, toolError } from '../shared';
import { resolveToolPath } from './path';

// 默认跳过的目录名：依赖与版本库数据不是工作对象，遍历成本也高。
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);

/** glob 模式转正则：** 跨目录、* 单层、? 单字符、[...] 字符类，路径分隔符统一为 /。 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*' && pattern[i + 2] === '/') {
        source += '(?:[^/]+/)*';
        i += 2;
      } else if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else if (char === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) source += '\\[';
      else {
        source += pattern.slice(i, end + 1);
        i = end;
      }
    } else if (char === '{') {
      // {a,b} 交替：拆成 (a|b)；嵌套花括号不支持。
      const end = pattern.indexOf('}', i + 1);
      if (end < 0 || pattern.slice(i + 1, end).includes('{')) source += '\\{';
      else {
        source += `(?:${pattern
          .slice(i + 1, end)
          .split(',')
          .map((branch) => branch.replace(/[.+^$()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        i = end;
      }
    } else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const MAX_RESULTS = 500;
const MAX_DEPTH = 16;

export const globTool = tool(
  '按 glob 模式查找文件，返回匹配的文件路径（相对 path 参数），按修改时间从新到旧排序。模式支持 **（跨目录）、*（单层）、? 与 [abc]；如 "**/*.md"、"src/**/*.ts"。默认跳过 node_modules 与 .git。',
  z
    .object({
      pattern: z.string().trim().min(1).max(500),
      path: z.string().trim().min(1).optional(),
    })
    .strict(),
  ({ pattern, path: input }, context) => {
    const root = resolveToolPath(input ?? '.', context);
    if (!statSync(root).isDirectory()) throw toolError('INVALID_INPUT', `不是目录：${root}`);
    const matcher = globToRegExp(pattern.replace(/\\/g, '/'));
    const matches: { path: string; mtimeMs: number }[] = [];
    const walk = (directory: string, depth: number) => {
      if (matches.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
      let children;
      try {
        children = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(child.name)) continue;
          walk(join(directory, child.name), depth + 1);
        } else if (child.isFile()) {
          const relativePath = relative(root, join(directory, child.name)).split(sep).join('/');
          if (!matcher.test(relativePath)) continue;
          matches.push({
            path: relativePath,
            mtimeMs: statSync(join(directory, child.name)).mtimeMs,
          });
          if (matches.length >= MAX_RESULTS) return;
        }
      }
    };
    walk(root, 0);
    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return {
      path: root,
      files: matches.map((match) => match.path),
      truncated: matches.length >= MAX_RESULTS,
    };
  },
);
