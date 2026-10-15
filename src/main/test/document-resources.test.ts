import { mkdtempSync, existsSync } from 'node:fs';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ root: '' }));
profile.root = mkdtempSync(join(tmpdir(), 'dela-document-resource-'));
vi.mock('electron', () => ({ app: { getPath: () => profile.root } }));
vi.mock('../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('../canvas/api', () => ({
  canvasFilePath: vi.fn(),
  getSource: vi.fn(),
  cachedFile: vi.fn(),
  readCanvasPage: vi.fn(),
  readCanvasSource: vi.fn(() => {
    throw new Error('GUI preview must not be called');
  }),
}));
vi.mock('../workspace/api', () => ({
  workspaceFilePath: vi.fn(),
  importWorkspaceFiles: vi.fn(),
  entry: vi.fn(),
  readWorkspaceEntry: vi.fn(() => {
    throw new Error('GUI preview must not be called');
  }),
}));
vi.mock('../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));
vi.mock('../settings/prefs', () => ({ assertShuiyuanEnabled: vi.fn() }));
vi.mock('../mail/api', () => ({
  readMailMessage: vi.fn(async () => ({ attachments: [{ part: '1', filename: '报名.xlsx' }] })),
  saveMailAttachment: vi.fn(async (_id: number, _part: string, path: string) =>
    writeFile(path, 'attachment bytes'),
  ),
  mailAttachment: vi.fn(() => ({ attachment: { filename: '报名.xlsx' } })),
}));
import {
  prepareDocumentResource,
  readResourceContent,
  releaseDocumentResource,
} from '../resources';
import { entry, readWorkspaceEntry, workspaceFilePath } from '../workspace/api';
import { cachedFile, getSource, readCanvasPage, readCanvasSource } from '../canvas/api';
import { readShuiyuanSource } from '../shuiyuan/api';
import { readResourceTool } from '../agent/domain/read-resource';
import { assertDocumentDependency } from '../documents/runtime';

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

it.each(['slides.pptx', 'archive.unknown'])(
  'returns a skill hint for %s without opening the file or querying GUI',
  async (name) => {
    const id = join(profile.root, name);
    vi.mocked(entry).mockReturnValue({
      id,
      name,
      kind: 'local',
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
  },
);

it('returns Canvas file metadata without downloading, identifying, or previewing it', async () => {
  vi.mocked(getSource).mockReturnValue({
    id: 'file:7',
    kind: 'file',
    courseId: 1,
    title: '课件.pptx',
  });
  const result = await readResourceTool.execute({ ref: { type: 'canvas', id: 'file:7' } });
  expect(result).toMatchObject({ title: '课件.pptx', format: 'file', readable: false });
  expect(cachedFile).not.toHaveBeenCalled();
  expect(readCanvasSource).not.toHaveBeenCalled();
});

it('reads and paginates a note with its revision without querying GUI', async () => {
  const id = join(profile.root, 'note.md');
  await writeFile(id, 'abcdef');
  vi.mocked(entry).mockReturnValue({
    id,
    path: id,
    name: 'note.md',
    kind: 'note',
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

it('preserves inline images for workspace and Canvas files', async () => {
  const id = join(profile.root, 'picture.jpg');
  await writeFile(id, Buffer.from([1, 2, 3]));
  vi.mocked(entry).mockReturnValue({
    id,
    path: id,
    name: 'picture.jpg',
    kind: 'local',
    parentId: null,
    sourceId: null,
    updatedAt: '',
  });
  vi.mocked(workspaceFilePath).mockResolvedValue(id);
  vi.mocked(getSource).mockReturnValue({
    id: 'file:8',
    courseId: 1,
    kind: 'file',
    title: 'picture.jpg',
    mime: 'image/jpeg',
  });
  vi.mocked(cachedFile).mockResolvedValue({ path: id, mime: 'image/jpeg' });
  for (const ref of [
    { type: 'workspace', id },
    { type: 'canvas', id: 'file:8' },
  ] as const) {
    expect(await readResourceTool.execute({ ref })).toMatchObject({
      format: 'image',
      images: [{ dataUrl: 'data:image/jpeg;base64,AQID', page: 1 }],
    });
  }
  expect(readWorkspaceEntry).not.toHaveBeenCalled();
  expect(readCanvasSource).not.toHaveBeenCalled();
});

it('reads linked Canvas pages and Shuiyuan sources through their body APIs', async () => {
  const id = join(profile.root, 'linked');
  const item = { id, name: 'linked', kind: 'source' as const, parentId: null, updatedAt: '' };
  vi.mocked(entry).mockReturnValue({ ...item, sourceId: 'page:1' });
  vi.mocked(getSource).mockReturnValue({
    id: 'page:1',
    courseId: 1,
    kind: 'page',
    title: '课程页面',
  });
  vi.mocked(readCanvasPage).mockResolvedValue({
    title: '课程页面',
    format: 'html',
    text: '<p>正文</p>',
    url: 'https://oc.sjtu.edu.cn/page',
    dueAt: undefined,
    updatedAt: undefined,
  });
  expect(await readResourceContent({ type: 'workspace', id })).toMatchObject({
    title: '课程页面',
    text: '<p>正文</p>',
  });
  vi.mocked(entry).mockReturnValue({ ...item, sourceId: 'shuiyuan-topic:7' });
  vi.mocked(readShuiyuanSource).mockResolvedValue({
    title: '帖子',
    format: 'text',
    text: '缓存摘要',
  });
  expect(await readResourceContent({ type: 'workspace', id })).toMatchObject({
    title: '帖子',
    format: 'text',
    text: '缓存摘要',
  });
  expect(readWorkspaceEntry).not.toHaveBeenCalled();
  expect(readCanvasSource).not.toHaveBeenCalled();
});

it('returns attachment metadata without downloading it', async () => {
  const result = await readResourceTool.execute({
    ref: { type: 'attachment', messageId: 1, part: '1' },
  });
  expect(result).toMatchObject({ title: '报名.xlsx', format: 'file', readable: false });
  const { saveMailAttachment } = await import('../mail/api');
  expect(saveMailAttachment).not.toHaveBeenCalled();
});
