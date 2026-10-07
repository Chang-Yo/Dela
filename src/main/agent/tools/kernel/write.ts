import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { tool } from '../shared';
import { filePath, revision } from './read';
import { resolveToolPath } from './path';

export const writeTool = tool(
  '创建或完整覆盖 UTF-8 文件，自动创建父目录。覆盖已有文件前先 Read；可传 revision（上次读取返回的哈希）防止覆盖外部修改。路径可以是绝对路径或相对当前工作目录。',
  z.object({ path: filePath, text: z.string(), revision: z.string().optional() }).strict(),
  ({ path: input, text, revision: expected }, context) => {
    const resolved = resolveToolPath(input, context);
    const path = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (expected !== undefined && revision(readFileSync(path, 'utf8')) !== expected)
      throw new Error('文件已修改，请重新读取');
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, {
        encoding: 'utf8',
        mode: existsSync(path) ? statSync(path).mode : undefined,
      });
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return { path, revision: revision(text), bytes: Buffer.byteLength(text) };
  },
);
