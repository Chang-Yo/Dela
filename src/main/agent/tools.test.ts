import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCanvasState } from '../canvas/api';
import { readWorkspaceEntry, saveWorkspaceNote } from '../workspace/api';
import { withResourceFile } from '../resources';
import { parseDocumentFile } from '../resource-parse';
import { searchWeb } from './web-search';
import { executeAgentTool, modelToolDefinitions } from './tools';

vi.mock('../canvas/api', () => ({
  getCanvasState: vi.fn(),
  readCanvasSource: vi.fn(),
  syncCanvasCourse: vi.fn(),
  syncCanvasCourses: vi.fn(),
}));
vi.mock('../mail/api', async () => {
  const { z } = await import('zod');
  return { mailSearchSchema: z.object({}), searchMail: vi.fn(), readMailMessage: vi.fn() };
});
vi.mock('../workspace/api', () => ({
  createWorkspaceEntry: vi.fn(),
  getWorkspaceState: vi.fn(),
  readWorkspaceEntry: vi.fn(),
  saveWorkspaceNote: vi.fn(),
  updateWorkspaceEntry: vi.fn(),
}));
vi.mock('../resources', () => ({
  copyResourceToProject: vi.fn(),
  withResourceFile: vi.fn(async (_source: unknown, consume: (path: string) => unknown) =>
    consume('C:/tmp/fake-document'),
  ),
}));
vi.mock('../resource-parse', () => ({
  parseDocumentFile: vi.fn(),
  parsableDocumentExtension: (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.pptx')) return 'pptx';
    return null;
  },
}));
vi.mock('./web-search', () => ({ fetchWebPage: vi.fn(), searchWeb: vi.fn() }));
vi.mock('../timetable/api', async () => {
  const { z } = await import('zod');
  return {
    createCalendarEvent: vi.fn(),
    querySchedule: vi.fn(),
    scheduleQuerySchema: z.object({}),
  };
});

const id = 'da21ec6f-71ae-414c-ae59-7618b0dac93e';
beforeEach(() => vi.resetAllMocks());

describe('Agent tool contracts', () => {
  it('exports serializable model schemas for every tool', () => {
    const definitions = modelToolDefinitions();
    expect(definitions.length).toBeGreaterThan(10);
    expect(JSON.parse(JSON.stringify(definitions))).toEqual(definitions);
    for (const definition of definitions)
      expect(definition.function.parameters.type).toBe('object');
  });

  it('rejects unknown tools and invalid arguments before executing', async () => {
    expect(await executeAgentTool('constructor', {})).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TOOL' },
    });
    expect(await executeAgentTool('write_note', { id, text: 'changed' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(saveWorkspaceNote).not.toHaveBeenCalled();
  });

  it('returns text pagination and current revision without preview bytes', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({
      title: 'Note',
      format: 'markdown',
      text: 'abcdef',
      revision: 'r1',
    });
    expect(
      await executeAgentTool('read_resource', {
        ref: { type: 'workspace', id },
        offset: 2,
        limit: 2,
      }),
    ).toMatchObject({
      ok: true,
      result: { text: 'cd', nextOffset: 4, totalCharacters: 6, revision: 'r1', readable: true },
    });
  });

  it('extracts PDF text through the document parser with pagination', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({
      title: 'Lecture.pdf',
      format: 'pdf',
      previewUrl: 'dela-resource://private',
    });
    vi.mocked(parseDocumentFile).mockResolvedValue({
      kind: 'pdf',
      text: 'abcdef',
      pages: 2,
      hasTextLayer: true,
    });
    const result = await executeAgentTool('read_resource', {
      ref: { type: 'workspace', id },
      offset: 2,
      limit: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        text: 'cd',
        nextOffset: 4,
        totalCharacters: 6,
        readable: true,
        pages: 2,
        format: 'pdf',
      },
    });
    expect(withResourceFile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('dela-resource');
  });

  it('reports scanned PDFs without a text layer as unreadable', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({ title: 'Scan.pdf', format: 'pdf' });
    vi.mocked(parseDocumentFile).mockResolvedValue({
      kind: 'pdf',
      text: '[第 1 页]\n',
      pages: 1,
      hasTextLayer: false,
    });
    expect(
      await executeAgentTool('read_resource', { ref: { type: 'workspace', id } }),
    ).toMatchObject({
      ok: true,
      result: { readable: false, nextOffset: null, hasTextLayer: false },
    });
  });

  it('parses unsupported office entries by file extension', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({
      title: 'Report.docx',
      format: 'unsupported',
    });
    vi.mocked(parseDocumentFile).mockResolvedValue({
      kind: 'docx',
      text: '内容',
      pages: 1,
      hasTextLayer: true,
    });
    const result = await executeAgentTool('read_resource', { ref: { type: 'workspace', id } });
    expect(result).toMatchObject({ ok: true, result: { format: 'docx', readable: true } });
    expect(withResourceFile).toHaveBeenCalledTimes(1);
  });

  it('searches the web and caps the returned result count', async () => {
    vi.mocked(searchWeb).mockResolvedValue(
      [1, 2, 3].map((n) => ({ title: `t${n}`, url: `https://example.com/${n}`, snippet: `s${n}` })),
    );
    const result = await executeAgentTool('web_search', { query: 'canvas', count: 2 });
    expect(searchWeb).toHaveBeenCalledWith('canvas', undefined);
    expect(result).toMatchObject({
      ok: true,
      result: { query: 'canvas', results: [{ title: 't1' }, { title: 't2' }] },
    });
  });

  it('returns a failed write as a failed operation', async () => {
    vi.mocked(saveWorkspaceNote).mockImplementation(() => {
      throw new Error('版本已改变');
    });
    expect(
      await executeAgentTool('write_note', { id, text: 'new', revision: 'old' }),
    ).toMatchObject({ ok: false, error: { code: 'OPERATION_FAILED', message: '版本已改变' } });
  });

  it('deduplicates Canvas sources and preserves partial sync evidence', async () => {
    const source = {
      id: 'node1',
      sourceId: 'file:1',
      parentId: null,
      courseId: 1,
      name: 'slides',
      kind: 'file' as const,
    };
    vi.mocked(getCanvasState).mockReturnValue({
      connected: true,
      syncedAt: null,
      courses: [
        { id: 1, name: 'Course', code: 'C', term: 'Fall', syncedAt: null, error: '文件同步失败' },
      ],
      items: [source, { ...source, id: 'node2' }],
    });
    expect(await executeAgentTool('search_sources', { query: 'slides' })).toMatchObject({
      ok: true,
      result: { total: 1, coverage: 'cached_titles', courses: [{ id: 1, error: '文件同步失败' }] },
    });
  });
});
