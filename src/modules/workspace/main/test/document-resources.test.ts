import { mkdtempSync, existsSync } from 'node:fs';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ root: '' }));
profile.root = mkdtempSync(join(tmpdir(), 'dela-document-resource-'));
vi.mock('electron', () => ({ app: { getPath: () => profile.root } }));
vi.mock('../../../preview', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  workspaceFilePath: vi.fn(),
  importWorkspaceFiles: vi.fn(),
  entry: vi.fn(),
  readWorkspaceEntry: vi.fn(() => {
    throw new Error('GUI preview must not be called');
  }),
}));
vi.mock('../../../mail/main/api', () => ({
  readMailMessage: vi.fn(async () => ({ attachments: [{ part: '1', filename: '报名.xlsx' }] })),
  saveMailAttachment: vi.fn(async (_id: number, _part: string, path: string) =>
    writeFile(path, 'attachment bytes'),
  ),
  mailAttachment: vi.fn(() => ({ attachment: { filename: '报名.xlsx' } })),
}));
import { prepareDocumentResource, releaseDocumentResource } from '../resources';
import { entry, readWorkspaceEntry, workspaceFilePath } from '../api';
import { attachmentResourceResolver, mailResourceResolver } from '../../../mail/main/resources';
import { readResourceTool, workspaceResourceResolver } from '../read-resource';
import { registerResourceResolver } from '../../../../core/capabilities/resources';
import { assertDocumentDependency } from '../../../preview';

registerResourceResolver('workspace', workspaceResourceResolver);
registerResourceResolver('mail', mailResourceResolver);
registerResourceResolver('attachment', attachmentResourceResolver);

beforeEach(() => vi.clearAllMocks());
afterAll(() => rm(profile.root, { recursive: true, force: true }));

it('keeps an attachment copy alive until the skill explicitly releases its job', async () => {
  const job = await prepareDocumentResource({ type: 'attachment', messageId: 1, part: '1' });
  expect(await readFile(job.input, 'utf8')).toBe('attachment bytes');
  expect(job.output).toBe(join(dirname(job.input), 'output'));
  await releaseDocumentResource(job.jobId);
  expect(existsSync(dirname(job.input))).toBe(false);
});

it('reads a snapshot and never removes the original workspace document', async () => {
  const source = join(profile.root, 'original.pdf');
  await writeFile(source, 'original document');
  vi.mocked(workspaceFilePath).mockResolvedValue(source);
  const job = await prepareDocumentResource({ type: 'workspace', id: source });
  await writeFile(source, 'edited after preparation');
  expect(await readFile(job.input, 'utf8')).toBe('original document');
  await releaseDocumentResource(job.jobId);
  expect(await readFile(source, 'utf8')).toBe('edited after preparation');
});

it('rejects cleanup traversal and checks the dependency before acquiring files', async () => {
  await expect(releaseDocumentResource('../original.pdf')).rejects.toThrow();
  vi.mocked(assertDocumentDependency).mockImplementationOnce(() => {
    throw new Error('missing component');
  });
  await expect(prepareDocumentResource({ type: 'workspace', id: 'missing.pdf' })).rejects.toThrow(
    'missing component',
  );
});

it('returns a skill hint for office documents without opening the file or querying GUI', async () => {
  const name = 'slides.pptx';
  const id = join(profile.root, name);
  vi.mocked(entry).mockReturnValue({
    id,
    name,
    kind: 'file',
    parentId: null,
    sourceId: null,
    updatedAt: '',
  });
  const result = await readResourceTool.execute({ ref: { type: 'workspace', id } });
  expect(result).toMatchObject({
    title: name,
    format: 'file',
    readable: false,
    hint: expect.stringContaining('document-reading'),
  });
  expect(workspaceFilePath).not.toHaveBeenCalled();
  expect(readWorkspaceEntry).not.toHaveBeenCalled();
});

it('classifies extensionless and dotfiles by content: text is readable, binary gets the skill hint', async () => {
  const text = join(profile.root, '.env');
  const binary = join(profile.root, 'core');
  await writeFile(text, 'KEY=value\n');
  await writeFile(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]));
  for (const [path, expected] of [
    [text, { format: 'text', text: 'KEY=value\n' }],
    [binary, { format: 'file', readable: false }],
  ] as const) {
    const name = basename(path);
    vi.mocked(entry).mockReturnValue({
      id: path,
      path,
      name,
      kind: 'file',
      parentId: null,
      sourceId: null,
      updatedAt: '',
    });
    vi.mocked(workspaceFilePath).mockResolvedValue(path);
    expect(await readResourceTool.execute({ ref: { type: 'workspace', id: path } })).toMatchObject(
      expected,
    );
  }
});

it('reads and paginates a note with its revision without querying GUI', async () => {
  const id = join(profile.root, 'note.md');
  await writeFile(id, 'abcdef');
  vi.mocked(entry).mockReturnValue({
    id,
    path: id,
    name: 'note.md',
    kind: 'file',
    parentId: null,
    sourceId: null,
    updatedAt: '',
  });
  vi.mocked(workspaceFilePath).mockResolvedValue(id);
  const result = await readResourceTool.execute({
    ref: { type: 'workspace', id },
    offset: 2,
    limit: 2,
  });
  expect(result).toMatchObject({
    format: 'markdown',
    text: 'cd',
    totalCharacters: 6,
    nextOffset: 4,
    revision: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(readWorkspaceEntry).not.toHaveBeenCalled();
});
