import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFilePath } from '../api';
import { copyResourceToProject, openResourceFile } from '../resources';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { hostPorts } from '../../../../core/ports';
import { sourceResourceResolver, workspaceResourceResolver } from '../read-resource';
import { registerWorkspaceSource } from '../sources';
import { attachmentResourceResolver, mailResourceResolver } from '../../../mail/main/resources';
import { registerResourceResolver } from '../../../../core/capabilities/resources';

vi.mock('../../../preview', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../../../mail/main/api', () => ({
  readMailMessage: vi.fn(),
  saveMailAttachment: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  importWorkspaceFiles: vi.fn(),
  workspaceFilePath: vi.fn(),
}));

registerResourceResolver('workspace', workspaceResourceResolver);
registerResourceResolver('source', sourceResourceResolver);
registerResourceResolver('mail', mailResourceResolver);
registerResourceResolver('attachment', attachmentResourceResolver);

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
  it('不支持的引用类型（如邮件附件）直接拒绝', async () => {
    await expect(openResourceFile({ type: 'attachment', messageId: 3, part: '1' })).rejects.toThrow(
      '仅支持资料文件与我的资料条目',
    );
    expect(open()).not.toHaveBeenCalled();
  });
});

describe('资源地址', () => {
  it('source 地址交给认领该 id 的模块，未登记的种类在读取前拒绝', async () => {
    const filePath = vi.fn(async () => 'cache/slides.pptx');
    registerWorkspaceSource({
      owns: (id) => id.startsWith('demo:'),
      validate: vi.fn(),
      filePath,
      preview: vi.fn(),
      read: vi.fn(),
    });
    vi.mocked(hostPorts().desktop.open).mockResolvedValue(undefined);

    await openResourceFile({ type: 'source', id: 'demo:1' });
    expect(filePath).toHaveBeenCalledWith('demo:1');
    expect(open()).toHaveBeenCalledWith('cache/slides.pptx');

    await expect(openResourceFile({ type: 'canvas', id: 'file:1' })).rejects.toThrow(
      '无法识别 canvas 类型的资源地址',
    );
    expect(open()).toHaveBeenCalledTimes(1);
  });
});
