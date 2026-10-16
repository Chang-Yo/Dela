import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../campus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../campus')>()),
  getCampusSession: async () => ({}),
}));
import { checkVideoLogin, listCourses, listVideos, parseStreams } from '../api';

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

describe.each(['courses', 'videos'] as const)('%s empty pages', (kind) => {
  const load = () => (kind === 'courses' ? listCourses() : listVideos(9000));
  beforeEach(() => {
    server.replies = kind === 'courses' ? [identity, [{ id: 11, currentTerm: true }]] : [identity];
  });

  it.each([null, []])('accepts a successful zero-count page with records=%j', async (records) => {
    server.replies.push({
      ok: true,
      dataOk: true,
      status: 200,
      data: { records, rowCount: 0, pageCount: 0 },
    });
    const expectedRequests = server.replies.length;
    await expect(load()).resolves.toEqual([]);
    expect(server.urls).toHaveLength(expectedRequests);
    const url = new URL(server.urls.at(-1)!);
    expect(url.pathname).toContain(
      kind === 'courses' ? 'myself/curriculum' : 'subject_vod_list_new',
    );
    expect(url.searchParams.get('page.pageIndex')).toBe('1');
    expect(url.searchParams.get('page.pageSize')).toBe('1000');
  });

  it.each([
    { records: null, rowCount: 1, pageCount: 0 },
    { records: null, rowCount: 0, pageCount: 1 },
    { records: null, pageCount: 0 },
    { records: null, rowCount: 0 },
    { records: null, rowCount: '0', pageCount: 0 },
    { records: null, rowCount: 0, pageCount: '0' },
    { rowCount: 0, pageCount: 0 },
    { records: {}, rowCount: 0, pageCount: 0 },
  ])('rejects incomplete or inconsistent empty data without retry (%j)', async (data) => {
    server.replies.push({ ok: true, dataOk: true, status: 200, data });
    const expectedRequests = server.replies.length;
    await expect(load()).rejects.toThrow('列表数据格式已变化');
    expect(server.urls).toHaveLength(expectedRequests);
  });

  it.each([
    [{ ok: false, dataOk: true, status: 200 }, '接口请求失败'],
    [{ ok: true, dataOk: false, status: 200 }, '列表数据格式已变化'],
    [{ dataOk: true, status: 200 }, '列表数据格式已变化'],
    [{ ok: true, status: 200 }, '列表数据格式已变化'],
    [{ ok: true, dataOk: true, status: 401 }, '登录'],
    [{ ok: true, dataOk: true, code: '-1' }, '登录'],
  ] as const)(
    'does not treat an unconfirmed or failed response as empty (%j)',
    async (status, error) => {
      server.replies.push({ ...status, data: { records: null, rowCount: 0, pageCount: 0 } });
      const expectedRequests = server.replies.length;
      await expect(load()).rejects.toThrow(error);
      expect(server.urls).toHaveLength(expectedRequests);
    },
  );
});

it('preserves video pagination, query parameters and field mapping', async () => {
  const video = {
    id: 12,
    courBeginTime: '2026-10-16 08:00:00',
    courEndTime: '2026-10-16 08:45:00',
  };
  server.replies = [
    identity,
    { ok: true, data: { records: [{ ...video, clroName: '教室', letiNumber: 1 }], pageCount: 2 } },
    {
      ok: true,
      data: { records: [{ ...video, id: 13, clroName: null, letiNumber: null }], pageCount: 2 },
    },
  ];
  await expect(listVideos(9000)).resolves.toEqual([
    { id: 12, start: video.courBeginTime, end: video.courEndTime, room: '教室', period: '1' },
    { id: 13, start: video.courBeginTime, end: video.courEndTime, room: '', period: '' },
  ]);
  expect(server.urls).toHaveLength(3);
  const query = new URL(server.urls[2]!).searchParams;
  expect(query.get('teclIds')).toBe('9000');
  expect(query.get('page.pageIndex')).toBe('2');
  expect(query.get('page.orders[0].asc')).toBe('false');
  expect(query.get('page.orders[0].field')).toBe('courBeginTime');
});

it('does not discard earlier pages when a later page unexpectedly reports zero total records', async () => {
  server.replies = [
    identity,
    { ok: true, data: { records: [{ id: 12 }], pageCount: 2 } },
    { ok: true, dataOk: true, data: { records: null, rowCount: 0, pageCount: 0 } },
  ];
  await expect(listVideos(9000)).rejects.toThrow('列表数据格式已变化');
  expect(server.urls).toHaveLength(3);
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
