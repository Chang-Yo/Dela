import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { canvasFilePath } from './canvas/api';
import { readMailMessage, saveMailAttachment } from './mail/api';
import { importWorkspaceFiles } from './workspace/api';
import { copyResourceToProject } from './resources';

vi.mock('electron', () => ({ app: { getPath: () => 'temp' } }));
vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('./canvas/api', () => ({ canvasFilePath: vi.fn() }));
vi.mock('./mail/api', () => ({ readMailMessage: vi.fn(), saveMailAttachment: vi.fn() }));
vi.mock('./workspace/api', () => ({ importWorkspaceFiles: vi.fn() }));
vi.mock('./storage', () => ({ diskName: (name: string) => name.replace(/[/\\]/g, '_') }));

const parentId = 'a03d4e01-ae55-4168-8572-ef88cb9f2e10';
afterEach(() => vi.resetAllMocks());

describe('copyResourceToProject', () => {
  it('returns the actual imported Canvas file reference', async () => {
    vi.mocked(canvasFilePath).mockResolvedValue('cached.pdf');
    const entry = { id: parentId, name: 'lecture.pdf' } as ReturnType<
      typeof importWorkspaceFiles
    >[number];
    vi.mocked(importWorkspaceFiles).mockReturnValue([entry]);
    const result = await copyResourceToProject({
      parentId,
      source: { type: 'canvas', id: 'file:7' },
    });
    expect(importWorkspaceFiles).toHaveBeenCalledWith(parentId, ['cached.pdf']);
    expect(result).toEqual({ ref: { type: 'workspace', id: parentId }, entry });
  });

  it('cleans temporary mail downloads when importing fails', async () => {
    vi.mocked(readMailMessage).mockResolvedValue({
      id: 1,
      uid: 1,
      subject: null,
      sender: null,
      date: null,
      seen: false,
      flagged: false,
      hasAttachments: true,
      snippet: null,
      size: null,
      to: [],
      cc: [],
      bodyText: '',
      bodyHtml: null,
      attachments: [{ part: '2', filename: 'report.pdf', size: null }],
    });
    vi.mocked(mkdtemp).mockResolvedValue('temporary');
    vi.mocked(importWorkspaceFiles).mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(
      copyResourceToProject({ parentId, source: { type: 'attachment', messageId: 1, part: '2' } }),
    ).rejects.toThrow('disk full');
    expect(saveMailAttachment).toHaveBeenCalledWith(1, '2', join('temporary', 'report.pdf'));
    expect(rm).toHaveBeenCalledWith('temporary', { recursive: true, force: true });
  });

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
