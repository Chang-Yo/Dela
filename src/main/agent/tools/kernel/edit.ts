import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { tool } from '../shared';
import { filePath, revision } from './read';
import { resolveToolPath } from './path';
import { writeTool } from './write';

export const editTool = tool(
  '局部替换 UTF-8 文件：oldText 必须在文件中唯一匹配，newText 为替换内容。可传 revision（上次读取返回的哈希）防止覆盖外部修改。保留其余内容与换行符。',
  z
    .object({
      path: filePath,
      oldText: z.string().min(1),
      newText: z.string(),
      revision: z.string().optional(),
    })
    .strict(),
  async ({ path: input, oldText, newText, revision: expected }, context) => {
    const path = resolveToolPath(input, context);
    const disk = readFileSync(path, 'utf8');
    if (expected !== undefined && revision(disk) !== expected)
      throw new Error('文件已修改，请重新读取');
    const start = disk.indexOf(oldText);
    if (start < 0) throw new Error('原文不存在，请重新读取');
    if (disk.indexOf(oldText, start + 1) >= 0) throw new Error('原文出现多次，请扩大匹配范围');
    return writeTool.execute(
      {
        path,
        text: disk.slice(0, start) + newText + disk.slice(start + oldText.length),
        revision: revision(disk),
      },
      context,
    );
  },
);
