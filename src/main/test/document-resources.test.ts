import { mkdtempSync, existsSync } from 'node:fs';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ root: '' }));
profile.root = mkdtempSync(join(tmpdir(), 'dela-document-resource-'));
vi.mock('electron', () => ({ app: { getPath: () => profile.root } }));
vi.mock('../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('../canvas/api', () => ({ canvasFilePath: vi.fn() }));
vi.mock('../workspace/api', () => ({ workspaceFilePath: vi.fn(), importWorkspaceFiles: vi.fn() }));
vi.mock('../mail/api', () => ({
  readMailMessage: vi.fn(async () => ({ attachments: [{ part: '1', filename: '报名.xlsx' }] })),
  saveMailAttachment: vi.fn(async (_id: number, _part: string, path: string) =>
    writeFile(path, 'attachment bytes'),
  ),
}));
import { prepareDocumentResource, releaseDocumentResource } from '../resources';
import { workspaceFilePath } from '../workspace/api';
import { assertDocumentDependency } from '../documents/runtime';

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
