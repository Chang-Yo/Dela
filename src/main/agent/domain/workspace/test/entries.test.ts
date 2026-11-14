// 工具层契约：remove_entry 的守卫与错误码映射、update_entry 的 kind 转换、
// list_workspace_entries 的浏览/过滤。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../workspace/api', () => ({
  createWorkspaceEntry: vi.fn(),
  getWorkspaceState: vi.fn(),
  updateWorkspaceEntry: vi.fn(),
  removeWorkspaceEntry: vi.fn(),
}));

import {
  createWorkspaceEntry,
  getWorkspaceState,
  removeWorkspaceEntry,
  updateWorkspaceEntry,
} from '../../../../workspace/api';
import { workspaceArchiveId } from '../../../../../shared/workspace';
import { createEntryTool, removeEntryTool, updateEntryTool } from '../entries';
import { listWorkspaceEntriesTool } from '../list-entries';

const id = 'da21ec6f-71ae-414c-ae59-7618b0dac93e';
const childId = '1f0a0e46-047b-4d4d-a3ca-8cf76687b16e';

beforeEach(() => vi.resetAllMocks());

describe('create_entry', () => {
  it('输入透传给业务层，返回工作区引用与条目', async () => {
    vi.mocked(createWorkspaceEntry).mockReturnValue({
      id,
      parentId: null,
      name: '笔记',
      kind: 'file',
      sourceId: null,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const entry = await createEntryTool.execute({ parentId: null, kind: 'file', name: '笔记' });
    expect(createWorkspaceEntry).toHaveBeenCalledWith({
      parentId: null,
      kind: 'file',
      name: '笔记',
    });
    expect(entry).toMatchObject({ ref: { type: 'workspace', id }, entry: { id, kind: 'file' } });
  });
});

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

describe('update_entry', () => {
  it('把 kind folder↔project 转换传给业务层，返回新 id 与路径映射', async () => {
    vi.mocked(updateWorkspaceEntry).mockReturnValue({ id, kind: undefined, ...{} } as never);
    vi.mocked(updateWorkspaceEntry).mockReturnValueOnce({
      id,
      fromPath: 'D:/ws/课题',
      toPath: 'D:/ws/毕业设计',
    });
    vi.mocked(getWorkspaceState).mockReturnValue({
      entries: [
        {
          id,
          parentId: null,
          name: 'A',
          kind: 'project',
          sourceId: null,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      directory: 'D:/ws',
    });
    await expect(
      updateEntryTool.execute({ id: 'D:/ws/课题', kind: 'project' }),
    ).resolves.toMatchObject({
      ref: { type: 'workspace', id },
      fromPath: 'D:/ws/课题',
      toPath: 'D:/ws/毕业设计',
      entry: { id, kind: 'project' },
    });
    expect(updateWorkspaceEntry).toHaveBeenCalledWith('D:/ws/课题', { kind: 'project' });
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
