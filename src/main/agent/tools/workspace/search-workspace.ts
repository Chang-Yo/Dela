import { z } from 'zod';
import { getWorkspaceState } from '../../../workspace/api';
import { limit, match, offset, page, query, tool, uuid } from '../shared';

export const searchWorkspaceTool = tool(
  '按名称搜索工作区条目；parentId 限定直接子条目。返回引用，不返回磁盘路径。',
  z.object({ query, parentId: uuid.nullable().optional(), offset, limit }).strict(),
  ({ query, parentId, offset, limit }) =>
    page(
      getWorkspaceState()
        .entries.filter(
          (item) =>
            (parentId === undefined || item.parentId === parentId) && match(item.name, query),
        )
        .map((item) => ({ ...item, ref: { type: 'workspace', id: item.id } })),
      offset,
      limit,
    ),
);
