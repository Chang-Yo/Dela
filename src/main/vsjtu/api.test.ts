import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  replies: [] as unknown[],
  urls: [] as string[],
  statuses: [] as number[],
}));
vi.mock('electron', () => ({
  net: {
    request: ({ url }: { url: string }) => {
      server.urls.push(url);
      const request = new EventEmitter() as EventEmitter & {
        end(): void;
        abort(): void;
        setHeader(): void;
      };
      request.abort = () => {};
      request.setHeader = () => {};
      request.end = () =>
        queueMicrotask(() => {
          const response = Object.assign(new EventEmitter(), {
            statusCode: server.statuses.shift() ?? 200,
          });
          request.emit('response', response);
          response.emit('data', Buffer.from(JSON.stringify(server.replies.shift())));
          response.emit('end');
        });
      return request;
    },
  },
}));
vi.mock('../timetable/session', () => ({ getCampusSession: async () => ({}) }));
import { checkVideoLogin, listCourses, listVideos, parseStreams } from './api';

beforeEach(() => {
  server.replies = [];
  server.urls = [];
  server.statuses = [];
});
const identity = { code: '0', result: { user: { code: 'test-user' } } };

it('shares simultaneous identity checks without caching the login result across later calls', async () => {
  server.replies = [identity, identity];
  await Promise.all([checkVideoLogin(), checkVideoLogin()]);
  expect(server.urls).toHaveLength(1);
  await checkVideoLogin();
  expect(server.urls).toHaveLength(2);
});

it('retries a temporary API failure but does not retry an expired session', async () => {
  server.replies = [null, identity, []];
  server.statuses = [503, 200, 200];
  expect(await listCourses()).toEqual([]);
  expect(server.urls[0]).toBe(server.urls[1]);
  server.replies = [null];
  server.statuses = [401];
  await expect(checkVideoLogin()).rejects.toThrow('登录');
  expect(server.urls).toHaveLength(4);
});

it('checks login before interpreting an empty curriculum as no courses', async () => {
  server.replies = [{ code: '-1', result: null }];
  await expect(listCourses()).rejects.toThrow('登录');
  expect(server.urls).toHaveLength(1);
});

it.each([
  [{ status: 200, result: [{ id: 11, currentTerm: true }] }],
  [[{ id: 11, currentTerm: true }]],
])(
  'discovers the current term from either official response shape and loads all pages (%j)',
  async (termResponse) => {
    server.replies = [
      identity,
      termResponse,
      {
        ok: true,
        data: {
          records: [{ teclId: 9000, subjCode: 'CS3313', subjName: '计算理论' }],
          pageCount: 2,
        },
      },
      {
        ok: true,
        data: {
          records: [
            { teclId: 9000, subjCode: 'CS3313', subjName: '计算理论' },
            { teclId: 9419, subjCode: 'CS2106', subjName: '大模型' },
          ],
          pageCount: 2,
        },
      },
    ];
    expect(await listCourses()).toEqual([
      { id: 9000, code: 'CS3313', name: '计算理论' },
      { id: 9419, code: 'CS2106', name: '大模型' },
    ]);
    const url = new URL(server.urls[3]!);
    expect(url.searchParams.get('acteId')).toBe('11');
    expect(url.searchParams.get('page.pageIndex')).toBe('2');
  },
);

it('reports a changed page contract instead of silently returning an empty video list', async () => {
  server.replies = [identity, { ok: true, data: { unexpected: [] } }];
  await expect(listVideos(9000)).rejects.toThrow('数据');
});

it('keeps both valid streams and rejects links outside the known media host', () => {
  const streams = parseStreams({
    courseVodViewList: [
      { url: 'https://live.sjtu.edu.cn/a.mp4?key=test', viewNum: 1, vodTime: 3308 },
      { url: 'https://live.sjtu.edu.cn/b.mp4?key=test', viewNum: 5, vodTime: 3309 },
    ],
  });
  expect(streams.map(({ view, duration }) => ({ view, duration }))).toEqual([
    { view: 1, duration: 3308 },
    { view: 5, duration: 3309 },
  ]);
  expect(() =>
    parseStreams({ courseVodViewList: [{ url: 'https://example.com/a.mp4', viewNum: 1 }] }),
  ).toThrow('地址');
});
