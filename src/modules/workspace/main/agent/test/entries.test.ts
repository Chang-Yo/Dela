import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  getWorkspaceState: vi.fn(),
  removeWorkspaceEntry: vi.fn(),
}));

import { getWorkspaceState, removeWorkspaceEntry } from '../../api';
import { workspaceArchiveId } from '../../../contract';
import { removeEntryTool } from '../entries';
import { listWorkspaceEntriesTool } from '../list-entries';

const id = 'da21ec6f-71ae-414c-ae59-7618b0dac93e';
const childId = '1f0a0e46-047b-4d4d-a3ca-8cf76687b16e';

beforeEach(() => vi.resetAllMocks());

describe('remove_entry', () => {
  it('删除成功返回 removed 与引用', async () => {
    await expect(removeEntryTool.execute({ id })).resolves.toEqual({
      removed: true,
      ref: { type: 'workspace', id },
    });
    expect(removeWorkspaceEntry).toHaveBeenCalledWith(id);
  });

  it('归档文件夹的守卫错误原样抛出', async () => {
    vi.mocked(removeWorkspaceEntry).mockImplementation(() => {
      throw new Error('归档文件夹不能移除');
    });
    await expect(removeEntryTool.execute({ id: workspaceArchiveId })).rejects.toThrow(
      '归档文件夹不能移除',
    );
  });

  it('条目不存在映射为 NOT_FOUND', async () => {
    vi.mocked(removeWorkspaceEntry).mockImplementation(() => {
      throw new Error('内容不存在');
    });
    await expect(removeEntryTool.execute({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('异步失败（子项目守卫等）原样抛出，不再被吞成假成功', async () => {
    vi.mocked(removeWorkspaceEntry).mockRejectedValue(
      new Error('项目下还有项目（子课题），请先移除它们'),
    );
    await expect(removeEntryTool.execute({ id })).rejects.toThrow('项目下还有项目');
  });
});

describe('list_workspace_entries', () => {
  it('空 query 即浏览，parentId 限定直接子条目，结果带 ref 与分页', async () => {
    vi.mocked(getWorkspaceState).mockReturnValue({
      entries: [
        {
          id,
          parentId: null,
          name: '项目A',
          kind: 'project',
          sourceId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: childId,
          parentId: id,
          name: '笔记B',
          kind: 'file',
          sourceId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      directory: 'D:/ws',
    });
    await expect(listWorkspaceEntriesTool.execute({ parentId: id })).resolves.toEqual({
      items: [expect.objectContaining({ name: '笔记B', ref: { type: 'workspace', id: childId } })],
      total: 1,
      nextOffset: null,
    });
  });
});
