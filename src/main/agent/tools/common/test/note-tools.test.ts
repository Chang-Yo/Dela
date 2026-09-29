// write_note / edit_note 工具层：Agent 写入必记版本（recordVersion）、
// 版本冲突映射 VERSION_CONFLICT、edit_note 参数透传与校验。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

vi.mock('../../../../workspace/api', () => ({
  saveWorkspaceNote: vi.fn(),
  editWorkspaceNote: vi.fn(),
}));

import { editWorkspaceNote, saveWorkspaceNote } from '../../../../workspace/api';
import { editNoteTool } from '../edit-note';
import { writeNoteTool } from '../edit';

const id = 'da21ec6f-71ae-414c-ae59-7618b0dac93e';

beforeEach(() => vi.resetAllMocks());

describe('write_note', () => {
  it('以 recordVersion 调用业务层并返回新 revision', async () => {
    vi.mocked(saveWorkspaceNote).mockReturnValue('rev-2');
    await expect(writeNoteTool.execute({ id, text: 'new', revision: 'rev-1' })).resolves.toEqual({
      ref: { type: 'workspace', id },
      revision: 'rev-2',
    });
    expect(saveWorkspaceNote).toHaveBeenCalledWith(id, 'new', 'rev-1', { recordVersion: true });
  });

  it('外部修改冲突映射为 VERSION_CONFLICT，消息保持原文', async () => {
    vi.mocked(saveWorkspaceNote).mockImplementation(() => {
      throw new Error('笔记已在外部修改。你的草稿仍在，请另存为新笔记或重新载入后编辑。');
    });
    await expect(
      writeNoteTool.execute({ id, text: 'new', revision: 'rev-1' }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: expect.stringContaining('外部修改'),
    });
  });

  it('其他写入失败保持原样（OPERATION_FAILED 由 registry 兜底）', async () => {
    vi.mocked(saveWorkspaceNote).mockImplementation(() => {
      throw new Error('只有笔记可以编辑');
    });
    await expect(writeNoteTool.execute({ id, text: 'new', revision: 'rev-1' })).rejects.toThrow(
      '只有笔记可以编辑',
    );
  });
});

describe('edit_note', () => {
  it('透传一组修改并合并返回新 revision 与定位摘要', async () => {
    vi.mocked(editWorkspaceNote).mockReturnValue({
      revision: 'rev-2',
      applied: [{ index: 1, line: 3, start: 20, removed: 4, added: 6, preview: '新文本' }],
    });
    await expect(
      editNoteTool.execute({
        id,
        revision: 'rev-1',
        edits: [{ oldText: '旧文本', newText: '新文本' }],
      }),
    ).resolves.toEqual({
      ref: { type: 'workspace', id },
      revision: 'rev-2',
      applied: [{ index: 1, line: 3, start: 20, removed: 4, added: 6, preview: '新文本' }],
    });
    expect(editWorkspaceNote).toHaveBeenCalledWith(
      id,
      [{ oldText: '旧文本', newText: '新文本' }],
      'rev-1',
    );
  });

  it('空 oldText 或空 edits 在 schema 层拒绝', () => {
    // tool 工厂先同步 schema.parse：校验失败是同步抛出，不是被拒绝的 Promise。
    expect(() =>
      editNoteTool.execute({ id, revision: 'r', edits: [{ oldText: '', newText: 'x' }] }),
    ).toThrow(ZodError);
    expect(() => editNoteTool.execute({ id, revision: 'r', edits: [] })).toThrow(ZodError);
  });
});
