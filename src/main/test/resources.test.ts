import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasFilePath } from '../canvas/api';
import { copyResourceToProject } from '../resources';

vi.mock('electron', () => ({ app: { getPath: () => 'temp' } }));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('../canvas/api', () => ({ canvasFilePath: vi.fn() }));
vi.mock('../mail/api', () => ({ readMailMessage: vi.fn(), saveMailAttachment: vi.fn() }));
vi.mock('../workspace/api', () => ({ importWorkspaceFiles: vi.fn() }));
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
