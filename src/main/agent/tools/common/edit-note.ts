import { z } from 'zod';
import { editWorkspaceNote } from '../../../workspace/api';
import { workspaceEntryIdSchema } from '../../../../shared/workspace';
import { tool } from '../shared';

export const editNoteTool = tool(
  '对 Markdown 笔记做局部修改（本地写）。流程：先 read_resource 读取并记录 revision → 把一组 {oldText, newText} 修改一次性提交 → 得到新 revision。每处 oldText 必须在正文中唯一出现，多处修改区间不能重叠；任何一处不满足则全部失败、笔记不变。版本不匹配（VERSION_CONFLICT）时重新读取最新内容再提交，不要盲目重试。返回每处修改的行号、位置与增删摘要。',
  z
    .object({
      id: workspaceEntryIdSchema,
      revision: z.string().min(1),
      edits: z
        .array(z.object({ oldText: z.string().min(1), newText: z.string() }))
        .min(1)
        .max(30),
    })
    .strict(),
  async ({ id, revision, edits }) => {
    const result = editWorkspaceNote(id, edits, revision);
    return { ref: { type: 'workspace', id }, ...result };
  },
);
