import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCanvasState } from '../canvas/api';
import { readWorkspaceEntry, saveWorkspaceNote } from '../workspace/api';
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
vi.mock('../resources', () => ({ copyResourceToProject: vi.fn() }));
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

  it('does not report PDF preview as extracted text', async () => {
    vi.mocked(readWorkspaceEntry).mockResolvedValue({
      title: 'Lecture',
      format: 'pdf',
      previewUrl: 'dela-resource://private',
    });
    const result = await executeAgentTool('read_resource', { ref: { type: 'workspace', id } });
    expect(result).toMatchObject({ ok: true, result: { readable: false, totalCharacters: null } });
    expect(JSON.stringify(result)).not.toContain('dela-resource');
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
