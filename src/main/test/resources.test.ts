import { afterEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';
import { canvasFilePath } from '../canvas/api';
import { workspaceFilePath } from '../workspace/api';
import { copyResourceToProject, openResourceFile } from '../resources';

vi.mock('electron', () => ({
  app: { getPath: () => 'temp' },
  shell: { openPath: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../canvas/api', () => ({ canvasFilePath: vi.fn() }));
vi.mock('../mail/api', () => ({ readMailMessage: vi.fn(), saveMailAttachment: vi.fn() }));
vi.mock('../workspace/api', () => ({ importWorkspaceFiles: vi.fn(), workspaceFilePath: vi.fn() }));
vi.mock('../storage', () => ({ diskName: (name: string) => name.replace(/[/\\]/g, '_') }));

const parentId = 'a03d4e01-ae55-4168-8572-ef88cb9f2e10';
afterEach(() => vi.resetAllMocks());

describe('copyResourceToProject', () => {
  it('rejects raw paths before accessing a resource', async () => {
    await expect(
      copyResourceToProject({
        parentId,
        source: { type: 'canvas', id: 'file:7', path: 'private' },
      }),
    ).rejects.toThrow();
    expect(canvasFilePath).not.toHaveBeenCalled();
  });
});

describe('openResourceFile', () => {
  it('canvas/workspace 引用解析到本地路径后交给 shell.openPath（系统默认应用）', async () => {
    vi.mocked(canvasFilePath).mockResolvedValue('C:/courses/a.pptx');
    vi.mocked(workspaceFilePath).mockResolvedValue('C:/ws/b.pptx');
    await openResourceFile({ type: 'canvas', id: 'file:7' });
    expect(vi.mocked(shell.openPath).mock.calls.at(-1)).toEqual(['C:/courses/a.pptx']);
    await openResourceFile({ type: 'workspace', id: parentId });
    expect(vi.mocked(shell.openPath).mock.calls.at(-1)).toEqual(['C:/ws/b.pptx']);
  });

  it('shell.openPath 返回错误串时抛出；不支持的引用类型（如邮件附件）直接拒绝', async () => {
    vi.mocked(canvasFilePath).mockResolvedValue('C:/c/a.pptx');
    vi.mocked(shell.openPath).mockResolvedValue('没有关联的应用');
    await expect(openResourceFile({ type: 'canvas', id: 'file:7' })).rejects.toThrow(
      '没有关联的应用',
    );
    await expect(openResourceFile({ type: 'attachment', messageId: 3, part: '1' })).rejects.toThrow(
      '仅支持资料文件与我的资料条目',
    );
    expect(shell.openPath).toHaveBeenCalledTimes(1);
  });
});
