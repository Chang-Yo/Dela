import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFilePath } from '../workspace/api';
import { copyResourceToProject, openResourceFile } from '../resources';
import { provideTestHostPorts } from '../../core/test/host-mock';
import { hostPorts } from '../../core/ports';
import { builtinResourceResolvers } from '../agent/domain/read-resource';
import { registerResourceResolver, type ResourceResolver } from '../../core/capabilities/resources';

vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../mail/api', () => ({ readMailMessage: vi.fn(), saveMailAttachment: vi.fn() }));
vi.mock('../workspace/api', () => ({ importWorkspaceFiles: vi.fn(), workspaceFilePath: vi.fn() }));
vi.mock('../storage', () => ({ diskName: (name: string) => name.replace(/[/\\]/g, '_') }));

for (const [type, resolver] of Object.entries(builtinResourceResolvers))
  registerResourceResolver(type, resolver as ResourceResolver);

const parentId = 'a03d4e01-ae55-4168-8572-ef88cb9f2e10';
afterEach(() => vi.resetAllMocks());
provideTestHostPorts({ paths: { temp: () => 'temp' } });
const open = () => vi.mocked(hostPorts().desktop.open);

describe('copyResourceToProject', () => {
  it('rejects raw paths before accessing a resource', async () => {
    await expect(
      copyResourceToProject({
        parentId,
        source: { type: 'workspace', id: parentId, path: 'private' },
      }),
    ).rejects.toThrow();
    expect(workspaceFilePath).not.toHaveBeenCalled();
  });
});

describe('openResourceFile', () => {
  it('引用解析到本地路径后交给系统默认应用打开', async () => {
    vi.mocked(workspaceFilePath).mockResolvedValue('C:/ws/b.pptx');
    await openResourceFile({ type: 'workspace', id: parentId });
    expect(open().mock.calls.at(-1)).toEqual(['C:/ws/b.pptx']);
  });

  it('系统打开失败时抛出；不支持的引用类型（如邮件附件）直接拒绝', async () => {
    vi.mocked(workspaceFilePath).mockResolvedValue('C:/ws/a.pptx');
    open().mockRejectedValue(new Error('没有关联的应用'));
    await expect(openResourceFile({ type: 'workspace', id: parentId })).rejects.toThrow(
      '没有关联的应用',
    );
    await expect(openResourceFile({ type: 'attachment', messageId: 3, part: '1' })).rejects.toThrow(
      '仅支持资料文件与我的资料条目',
    );
    expect(open()).toHaveBeenCalledTimes(1);
  });
});
