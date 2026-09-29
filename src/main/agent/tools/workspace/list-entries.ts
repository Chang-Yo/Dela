import { z } from 'zod';
import { getWorkspaceState } from '../../../workspace/api';
import { limit, match, offset, page, query, tool, uuid } from '../shared';

export const listWorkspaceEntriesTool = tool(
  '浏览或按名称弱过滤工作区条目（项目、文件夹、笔记、来源引用、导入文件）。只读。query 为空即浏览；parentId 限定直接子条目，缺省列全部。返回条目与可传 read_resource 的引用，不返回磁盘路径。',
  z.object({ query, parentId: uuid.nullable().optional(), offset, limit }).strict(),
  async ({ query, parentId, offset, limit }) =>
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
