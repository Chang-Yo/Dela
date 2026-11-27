import { afterEach, describe, expect, it, vi } from 'vitest';
import { importWorkspaceFiles, workspaceFilePath } from '../api';
import { copyResourceToProject } from '../resources';
import type { WorkspaceEntry } from '../../contract';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { sourceResourceResolver, workspaceResourceResolver } from '../read-resource';
import { registerWorkspaceSource } from '../sources';
import { attachmentResourceResolver, mailResourceResolver } from '../../../mail/main/resources';
import { registerResourceResolver } from '../../../../core/capabilities/resources';

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
provideTestHostPorts({});

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

describe('资源地址', () => {
  it('source 地址交给认领该 id 的模块，未登记的种类在读取前拒绝', async () => {
    const filePath = vi.fn(async () => 'cache/slides.pptx');
    registerWorkspaceSource({
      prefix: 'demo:',
      validate: vi.fn(),
      filePath,
      preview: vi.fn(),
      read: vi.fn(),
    });
    vi.mocked(importWorkspaceFiles).mockReturnValue([{ id: 'copied' } as WorkspaceEntry]);

    await copyResourceToProject({ parentId, source: { type: 'source', id: 'demo:1' } });
    expect(filePath).toHaveBeenCalledWith('demo:1');
    expect(importWorkspaceFiles).toHaveBeenCalledWith(parentId, ['cache/slides.pptx']);

    await expect(
      copyResourceToProject({ parentId, source: { type: 'canvas', id: 'file:1' } }),
    ).rejects.toThrow('无法识别 canvas 类型的资源地址');
    expect(importWorkspaceFiles).toHaveBeenCalledTimes(1);
  });
});
