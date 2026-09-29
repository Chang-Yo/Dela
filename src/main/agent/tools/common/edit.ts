import { z } from 'zod';
import { saveWorkspaceNote } from '../../../workspace/api';
import { tool, uuid } from '../shared';

export const writeNoteTool = tool(
  '替换 Markdown 笔记正文。必须先读取并提供当前 revision；版本不匹配时重新读取，不盲目重试。',
  z.object({ id: uuid, text: z.string().max(1000000), revision: z.string().min(1) }).strict(),
  ({ id, text, revision }) => ({
    ref: { type: 'workspace', id },
    revision: saveWorkspaceNote(id, text, revision),
  }),
);
