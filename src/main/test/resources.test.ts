import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasFilePath } from '../canvas/api';
import { workspaceFilePath } from '../workspace/api';
import { copyResourceToProject, openResourceFile } from '../resources';
import { provideTestHostPorts } from './host-mock';
import { hostPorts } from '../host';

vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../canvas/api', () => ({ canvasFilePath: vi.fn() }));
vi.mock('../mail/api', () => ({ readMailMessage: vi.fn(), saveMailAttachment: vi.fn() }));
vi.mock('../workspace/api', () => ({ importWorkspaceFiles: vi.fn(), workspaceFilePath: vi.fn() }));
vi.mock('../storage', () => ({ diskName: (name: string) => name.replace(/[/\\]/g, '_') }));

const parentId = 'a03d4e01-ae55-4168-8572-ef88cb9f2e10';
afterEach(() => vi.resetAllMocks());
provideTestHostPorts({ paths: { temp: () => 'temp' } });
const open = () => vi.mocked(hostPorts().desktop.open);

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
  it('canvas/workspace 引用解析到本地路径后交给系统默认应用打开', async () => {
    vi.mocked(canvasFilePath).mockResolvedValue('C:/courses/a.pptx');
    vi.mocked(workspaceFilePath).mockResolvedValue('C:/ws/b.pptx');
    await openResourceFile({ type: 'canvas', id: 'file:7' });
    expect(open().mock.calls.at(-1)).toEqual(['C:/courses/a.pptx']);
    await openResourceFile({ type: 'workspace', id: parentId });
    expect(open().mock.calls.at(-1)).toEqual(['C:/ws/b.pptx']);
  });

  it('系统打开失败时抛出；不支持的引用类型（如邮件附件）直接拒绝', async () => {
    vi.mocked(canvasFilePath).mockResolvedValue('C:/c/a.pptx');
    open().mockRejectedValue(new Error('没有关联的应用'));
    await expect(openResourceFile({ type: 'canvas', id: 'file:7' })).rejects.toThrow(
      '没有关联的应用',
    );
    await expect(openResourceFile({ type: 'attachment', messageId: 3, part: '1' })).rejects.toThrow(
      '仅支持资料文件与我的资料条目',
    );
    expect(open()).toHaveBeenCalledTimes(1);
  });
});
