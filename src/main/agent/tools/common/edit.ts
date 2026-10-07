import { z } from 'zod';
import { saveWorkspaceNote } from '../../../workspace/api';
import { workspaceEntryIdSchema } from '../../../../shared/workspace';
import { tool, toolError } from '../shared';

export const writeNoteTool = tool(
  '整篇替换 Markdown 笔记正文（本地写）。必须先用 read_resource 读取并携带返回的 revision；版本不匹配（VERSION_CONFLICT）说明笔记已在外部变化，重新读取最新内容后再写，不要盲目重试。小改动优先用 edit_note。',
  z
    .object({
      id: workspaceEntryIdSchema,
      text: z.string().max(1000000),
      revision: z.string().min(1),
    })
    .strict(),
  async ({ id, text, revision }) => {
    try {
      const next = saveWorkspaceNote(id, text, revision, { recordVersion: true });
      return { ref: { type: 'workspace', id }, revision: next };
    } catch (error) {
      // saveWorkspaceNote 的版本冲突消息保持原文，错误码统一为 VERSION_CONFLICT。
      if (error instanceof Error && error.message.includes('外部修改'))
        throw toolError('VERSION_CONFLICT', error.message);
      throw error;
    }
  },
);
