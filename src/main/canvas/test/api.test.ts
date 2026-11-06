// 课程同步的「通知与讨论」：讨论列表不含公告，公告须经 only_announcements 单独并入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../credentials', () => ({
  loadCanvasToken: () => 'token',
  saveCanvasToken: vi.fn(),
}));

import { closeDatabase, getDatabase } from '../../database';
import { canvasFilePath, syncCanvasCourse } from '../api';

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
});

describe('downloadFile redirects', () => {
  const pdf = '%PDF-1.7';

  function stubDownload(fileId: number, location: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = new URL(String(input));
        if (url.pathname === `/api/v1/files/${fileId}`)
          return respond({
            url: `https://oc.sjtu.edu.cn/files/${fileId}/download?download_frd=1`,
            size: pdf.length,
            'content-type': 'application/pdf',
          });
        if (url.hostname === 'oc.sjtu.edu.cn')
          return new Response(null, { status: 302, headers: { location } });
        return new Response(Buffer.from(pdf), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        });
      }),
    );
  }

  function addFile(fileId: number) {
    getDatabase()
      .prepare('INSERT INTO canvas_sources(id, course_id, data) VALUES (?, ?, ?)')
      .run(
        `file:${fileId}`,
        1,
        JSON.stringify({
          id: `file:${fileId}`,
          courseId: 1,
          title: `讲义-${fileId}.pdf`,
          kind: 'file',
          fileId,
          mime: 'application/pdf',
          size: pdf.length,
          updatedAt: '2026-09-01T00:00:00Z',
        }),
      );
  }

  it('follows a presigned bucket subdomain without forwarding Authorization', async () => {
    const fileId = 101;
    addFile(fileId);
    stubDownload(
      fileId,
      'https://331a60d07b0a4ac5b121dba66bf2b863-files.s3.jcloud.sjtu.edu.cn/object',
    );
    const path = await canvasFilePath(`file:${fileId}`);
    expect(readFileSync(path, 'utf8')).toBe(pdf);
    const calls = vi.mocked(fetch).mock.calls;
    const init = calls[2]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  it('rejects a redirect outside the Canvas storage hosts', async () => {
    const fileId = 102;
    addFile(fileId);
    stubDownload(fileId, 'https://evil.example/object');
    await expect(canvasFilePath(`file:${fileId}`)).rejects.toThrow('Canvas 下载重定向无效');
  });
});
