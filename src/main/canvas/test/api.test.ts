// 课程同步的「通知与讨论」：交大 Canvas 的讨论列表过滤公告，公告须经 only_announcements 单独并入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../credentials', () => ({
  loadCanvasToken: () => 'token',
  saveCanvasToken: vi.fn(),
}));

import { closeDatabase, getDatabase } from '../../database';
import { syncCanvasCourse } from '../api';

const course = {
  id: 1,
  name: '操作系统',
  term: '2026 秋',
  code: 'CS260',
  syncedAt: null,
  error: null,
};

const announcement = {
  id: 900,
  title: '期中考试安排',
  message: '<p>下周期中考试</p>',
  html_url: 'https://oc.sjtu.edu.cn/courses/1/discussion_topics/900',
  last_reply_at: null,
};

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function stubCanvas(topics: unknown[], announcements: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/discussion_topics'))
        return respond(
          url.searchParams.get('only_announcements') === 'true' ? announcements : topics,
        );
      return respond([]);
    }),
  );
}

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-canvas-'));
  getDatabase()
    .prepare('INSERT INTO canvas_courses(id, data, items) VALUES (?, ?, ?)')
    .run(1, JSON.stringify(course), '[]');
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('syncCanvasCourse discussions', () => {
  it('includes announcements that the discussion list omits', async () => {
    stubCanvas([], [announcement]);
    const synced = await syncCanvasCourse(1);
    expect(
      synced.items.filter((item) => item.courseId === 1 && item.kind === 'discussion'),
    ).toEqual([
      {
        id: 'discussion:1:900',
        parentId: '1:discussions',
        courseId: 1,
        name: '期中考试安排',
        kind: 'discussion',
        sourceId: 'discussion:1:900',
      },
    ]);
    const stored = getDatabase()
      .prepare('SELECT data FROM canvas_sources WHERE id=?')
      .get('discussion:1:900') as { data: string };
    expect(JSON.parse(stored.data)).toMatchObject({ title: '期中考试安排', courseId: 1 });
  });

  it('does not duplicate announcements already present in the discussion list', async () => {
    stubCanvas([announcement], [announcement]);
    const synced = await syncCanvasCourse(1);
    expect(synced.items.filter((item) => item.sourceId === 'discussion:1:900')).toHaveLength(1);
  });
});
