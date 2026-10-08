import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasState } from '../../../../../shared/canvas';
import { canvasTools } from '../index';

vi.mock('../../../../canvas/api', () => ({
  getCanvasState: vi.fn(),
  syncCanvasCourses: vi.fn(),
  syncCanvasCourse: vi.fn(),
}));

import { getCanvasState, syncCanvasCourse, syncCanvasCourses } from '../../../../canvas/api';

const state = vi.mocked(getCanvasState);
const syncCourses = vi.mocked(syncCanvasCourses);
const syncCourse = vi.mocked(syncCanvasCourse);

function canvasState(overrides: Partial<CanvasState> = {}): CanvasState {
  return {
    connected: true,
    syncedAt: '2026-09-01T00:00:00.000Z',
    courses: [
      {
        id: 1,
        name: '操作系统',
        term: '2026 秋',
        code: 'CS260',
        syncedAt: '2026-09-10T00:00:00.000Z',
        error: null,
      },
      {
        id: 2,
        name: '数据结构',
        term: '2025 春',
        code: 'CS210',
        syncedAt: null,
        error: '文件：Canvas HTTP 500',
        archived: true,
      },
    ],
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.mockReturnValue(canvasState());
});

/** 同步工具的校验/前置检查错误在 execute 调用时同步抛出（registry 捕获后映射）。 */
function expectSyncToolError(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('expected the tool to throw');
}

describe('get_canvas_status', () => {
  it('separates credential presence from verification and per-course sync state', () => {
    const result = canvasTools.get_canvas_status.execute({});
    expect(result).toEqual({
      credentialSaved: true,
      courseListSyncedAt: '2026-09-01T00:00:00.000Z',
      courses: [
        {
          id: 1,
          name: '操作系统',
          term: '2026 秋',
          code: 'CS260',
          archived: false,
          contentSyncedAt: '2026-09-10T00:00:00.000Z',
          error: null,
        },
        {
          id: 2,
          name: '数据结构',
          term: '2025 春',
          code: 'CS210',
          archived: true,
          contentSyncedAt: null,
          error: '文件：Canvas HTTP 500',
        },
      ],
    });
    expect(syncCourses).not.toHaveBeenCalled();
  });

  it('guides the model when no token is saved or the list was never synced', () => {
    state.mockReturnValue(canvasState({ connected: false, syncedAt: null }));
    const missing = canvasTools.get_canvas_status.execute({}) as {
      credentialSaved: boolean;
      warnings: string[];
    };
    expect(missing.credentialSaved).toBe(false);
    expect(missing.warnings).toHaveLength(1);
    expect(missing.warnings[0]).toContain('未保存 Canvas 访问令牌');

    state.mockReturnValue(canvasState({ syncedAt: null }));
    const unsynced = canvasTools.get_canvas_status.execute({}) as { warnings: string[] };
    expect(unsynced.warnings[0]).toContain('课程列表尚未同步');
  });
});

describe('list_canvas_courses', () => {
  it('filters archived courses out by default and keeps them on request', async () => {
    const result = (await canvasTools.list_canvas_courses.execute({ query: '' })) as {
      items: { id: number; archived: boolean }[];
      total: number;
      freshness: unknown;
    };
    expect(result.items.map((item) => item.id)).toEqual([1]);
    expect(result.freshness).toEqual({ kind: 'cached', syncedAt: '2026-09-01T00:00:00.000Z' });

    const all = (await canvasTools.list_canvas_courses.execute({
      query: '',
      includeArchived: true,
    })) as { items: { id: number }[]; total: number };
    expect(all.items.map((item) => item.id)).toEqual([1, 2]);
    expect(all.total).toBe(2);
  });

  it('applies the weak query filter across name, code and term', async () => {
    const result = (await canvasTools.list_canvas_courses.execute({ query: 'cs260' })) as {
      items: { id: number }[];
    };
    expect(result.items.map((item) => item.id)).toEqual([1]);
  });

  it('returns NOT_CONFIGURED without a token and NOT_FOUND before the first list sync', () => {
    state.mockReturnValue(canvasState({ connected: false }));
    expectSyncToolError(
      () => canvasTools.list_canvas_courses.execute({ query: '' }),
      'NOT_CONFIGURED',
    );

    state.mockReturnValue(canvasState({ syncedAt: null }));
    expectSyncToolError(() => canvasTools.list_canvas_courses.execute({ query: '' }), 'NOT_FOUND');
  });
});

describe('search_canvas_sources', () => {
  it('deduplicates by sourceId and returns readable refs with unified coverage', async () => {
    const source = {
      id: 'node1',
      sourceId: 'file:1',
      parentId: null,
      courseId: 1,
      name: 'slides',
      kind: 'file' as const,
    };
    state.mockReturnValue(canvasState({ items: [source, { ...source, id: 'node2' }] }));
    const result = (await canvasTools.search_canvas_sources.execute({ query: 'slides' })) as {
      items: { ref: unknown; title: string }[];
      total: number;
      coverage: unknown;
      freshness: unknown;
    };
    expect(result.items).toEqual([
      {
        ref: { type: 'canvas', id: 'file:1' },
        title: 'slides',
        courseId: 1,
        kind: 'file',
        dueAt: null,
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.coverage).toEqual({ scope: 'cached_titles', complete: true });
    expect(result.freshness).toEqual({ kind: 'cached', syncedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('returns NOT_CONFIGURED when Canvas is not connected', () => {
    state.mockReturnValue(canvasState({ connected: false }));
    expectSyncToolError(
      () => canvasTools.search_canvas_sources.execute({ query: 'slides' }),
      'NOT_CONFIGURED',
    );
  });
});

describe('refresh_canvas_courses', () => {
  it('refreshes only the course list and reports the synced time', async () => {
    syncCourses.mockResolvedValue(canvasState());
    const result = (await canvasTools.refresh_canvas_courses.execute({})) as {
      courseListSyncedAt: string;
      courses: unknown[];
    };
    expect(syncCourses).toHaveBeenCalledTimes(1);
    expect(result.courseListSyncedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(result.courses).toHaveLength(2);
  });

  it('maps upstream failures to contract error codes', async () => {
    state.mockReturnValue(canvasState({ connected: false }));
    await expect(canvasTools.refresh_canvas_courses.execute({})).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });

    state.mockReturnValue(canvasState());
    syncCourses.mockRejectedValue(new Error('Canvas HTTP 401：令牌失效或无权访问此内容'));
    await expect(canvasTools.refresh_canvas_courses.execute({})).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
    });

    syncCourses.mockRejectedValue(new Error('无法连接 Canvas，请检查网络后重试'));
    await expect(canvasTools.refresh_canvas_courses.execute({})).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

describe('refresh_canvas_course', () => {
  it('expresses partial branch failures without failing the whole sync', async () => {
    // syncCanvasCourse 的返回值才是工具读取的课程状态（getCanvasState 是同步前置检查用的）。
    const partialState = canvasState({
      courses: [
        {
          id: 1,
          name: '操作系统',
          term: '2026 秋',
          code: 'CS260',
          syncedAt: '2026-09-29T00:00:00.000Z',
          error: '文件：Canvas HTTP 500\n课程模块：请求超时',
        },
      ],
    });
    syncCourse.mockResolvedValue(partialState);
    const result = (await canvasTools.refresh_canvas_course.execute({ courseId: 1 })) as {
      branches: { key: string; ok: boolean; error: string | null }[];
      complete: boolean;
      warnings: string[];
    };
    expect(result.branches).toEqual([
      { key: 'files', label: '文件', ok: false, error: 'Canvas HTTP 500' },
      { key: 'assignments', label: '作业', ok: true, error: null },
      { key: 'discussions', label: '通知与讨论', ok: true, error: null },
      { key: 'modules', label: '课程模块', ok: false, error: '请求超时' },
    ]);
    expect(result.complete).toBe(false);
    expect(result.warnings[0]).toContain('文件：Canvas HTTP 500');
  });

  it('reports a fully successful sync', async () => {
    state.mockReturnValue(
      canvasState({
        courses: [
          {
            id: 1,
            name: '操作系统',
            term: '2026 秋',
            code: 'CS260',
            syncedAt: '2026-09-29T00:00:00.000Z',
            error: null,
          },
        ],
      }),
    );
    syncCourse.mockResolvedValue(canvasState());
    const result = (await canvasTools.refresh_canvas_course.execute({ courseId: 1 })) as {
      branches: { ok: boolean }[];
      complete: boolean;
      warnings?: string[];
    };
    expect(result.branches.every((branch) => branch.ok)).toBe(true);
    expect(result.complete).toBe(true);
    expect(result).not.toHaveProperty('warnings');
  });

  it('maps unknown courses and auth failures', async () => {
    state.mockReturnValue(canvasState());
    syncCourse.mockRejectedValue(new Error('课程不存在，请刷新课程列表'));
    await expect(canvasTools.refresh_canvas_course.execute({ courseId: 99 })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );

    syncCourse.mockRejectedValue(new Error('Canvas HTTP 401：令牌失效或无权访问此内容'));
    await expect(canvasTools.refresh_canvas_course.execute({ courseId: 1 })).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
    });
  });
});
