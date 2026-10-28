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
          response.emit('data', Buffer.from(JSON.stringify(server.replies.shift() ?? null)));
          response.emit('end');
        });
      return request;
    },
  },
}));
const canvas = vi.hoisted(() => ({
  token: null as string | null,
  login: vi.fn(),
  loginUrl: vi.fn(),
  courses: [] as { id: number; name: string; code: string; term: string; archived?: boolean }[],
}));
vi.mock('../../campus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../campus')>()),
  getCampusSession: async () => ({}),
  flushCampusSession: async () => {},
  hiddenCampusLogin: canvas.login,
}));
vi.mock('../../credentials', () => ({ loadCanvasToken: () => canvas.token }));
vi.mock('../../canvas/api', () => ({
  classroomLoginUrl: canvas.loginUrl,
  getCanvasState: () => ({ courses: canvas.courses }),
}));
import { checkVideoLogin, listCourses, listVideos, parseStreams } from '../api';

beforeEach(() => {
  server.replies = [];
  server.urls = [];
  server.statuses = [];
  canvas.token = null;
  canvas.login.mockReset();
  canvas.loginUrl
    .mockReset()
    .mockResolvedValue('https://oc.sjtu.edu.cn/courses/1/external_tools/2?session_token=x');
  canvas.courses = [];
});
const identity = { code: '0', result: { user: { code: 'test-user' } } };

it('uses the same synced Canvas courses as materials, including same-name classes and older terms', async () => {
  canvas.token = 'token';
  canvas.courses = [
    { id: 42, name: '大学物理（荣誉）（2）', code: 'PHYS-01', term: '2026-2027 Fall' },
    { id: 43, name: '大学物理（荣誉）（2）', code: 'PHYS-02', term: '2026-2027 Fall' },
    { id: 10, name: '往年课程', code: 'OLD', term: '2025-2026 Fall' },
    { id: 11, name: '已归档', code: 'ARCHIVE', term: '2025-2026 Fall', archived: true },
  ];
  await expect(listCourses()).resolves.toEqual([
    { id: 42, name: '大学物理（荣誉）（2）', code: 'PHYS-01', source: 'canvas' },
    { id: 43, name: '大学物理（荣誉）（2）', code: 'PHYS-02', source: 'canvas' },
    { id: 10, name: '往年课程', code: 'OLD', source: 'canvas' },
  ]);
  expect(server.urls).toEqual([]);
});

it('resolves a Canvas course through its own LTI entry before querying video teaching-class IDs', async () => {
  canvas.token = 'token';
  canvas.login.mockImplementation(async (_url, probe) =>
    probe([
      'https://oc.sjtu.edu.cn/courses/42/external_tools/2',
      'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center?teclId=9001&target=video',
    ]),
  );
  server.replies = [identity, { ok: true, data: { records: [], pageCount: 0 } }];
  await expect(listVideos(42, 'canvas')).resolves.toEqual([]);
  expect(canvas.loginUrl).toHaveBeenCalledWith(42);
  expect(new URL(server.urls.at(-1)!).searchParams.get('teclIds')).toBe('9001');
  expect(
    server.urls.some((url) => url.includes('curriculum') || url.includes('group_subject')),
  ).toBe(false);
});

it('reports a missing Canvas video entry without querying a different course', async () => {
  canvas.token = 'token';
  canvas.loginUrl.mockRejectedValue(new Error('Canvas 课程中没有找到课堂视频入口'));
  await expect(listVideos(42, 'canvas')).rejects.toThrow('课堂视频入口');
  expect(server.urls).toEqual([]);
});

it.each([
  'https://example.com/#/play-center?teclId=9001',
  'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/home?teclId=9001',
  'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center?teclId=invalid',
])(
  'does not resolve a teaching class from an unrelated or invalid landing URL (%s)',
  async (url) => {
    canvas.token = 'token';
    canvas.login.mockImplementation(async (_url, probe) => probe([url]));
    await expect(listVideos(42, 'canvas')).rejects.toThrow();
    expect(server.urls).toEqual([]);
  },
);

it('treats the identity endpoint answering 500 as an expired session rather than an outage', async () => {
  server.replies = [{ code: '-1', status: 500 }];
  server.statuses = [500];
  await expect(checkVideoLogin()).rejects.toThrow('登录交大视频');
  expect(server.urls).toEqual(['https://v.sjtu.edu.cn/jy-application-resourcemanage/authority/me']);
});

it('logs in through the Canvas token once and retries the expired request', async () => {
  canvas.token = 'token';
  server.replies = [null, identity];
  server.statuses = [500, 200];
  await checkVideoLogin();
  expect(server.urls).toHaveLength(2);
  expect(canvas.login).toHaveBeenCalledOnce();
  const [url, probe] = canvas.login.mock.calls[0]!;
  expect(url).toBe('https://oc.sjtu.edu.cn/courses/1/external_tools/2?session_token=x');
  // 登录窗口的探测不能再触发 Canvas 登录，否则会等待自身。
  server.replies = [null, identity];
  server.statuses = [401, 200];
  await expect(probe()).rejects.toThrow('登录');
  await probe();
  expect(canvas.login).toHaveBeenCalledOnce();
});

it('reports the expired session instead of looping when Canvas login does not restore it', async () => {
  canvas.token = 'token';
  server.replies = [null, null];
  server.statuses = [401, 401];
  await expect(checkVideoLogin()).rejects.toThrow('登录交大视频');
  expect(canvas.login).toHaveBeenCalledOnce();
  canvas.login.mockRejectedValueOnce(new Error('登录超时'));
  server.replies = [null];
  server.statuses = [401];
  await expect(checkVideoLogin()).rejects.toThrow('通过 Canvas 登录交大视频失败：登录超时');
});

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
    expect(server.urls).toHaveLength(4);
    expect(server.urls.some((url) => url.includes('group_subject_vod_list'))).toBe(false);
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
    if (kind === 'courses')
      server.replies.push({
        ok: true,
        dataOk: true,
        data: { records, rowCount: 0, pageCount: 0 },
      });
    const expectedRequests = server.replies.length;
    await expect(load()).resolves.toEqual([]);
    expect(server.urls).toHaveLength(expectedRequests);
    const url = new URL(server.urls.at(-1)!);
    expect(url.pathname).toContain(
      kind === 'courses' ? 'group_subject_vod_list/t-1' : 'subject_vod_list_new',
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
    [{ ok: true, dataOk: false, status: 200 }, '接口请求失败'],
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

describe('on-demand course fallback', () => {
  beforeEach(() => {
    server.replies = [
      identity,
      [{ id: 11, currentTerm: true }, { id: 12 }],
      { ok: true, dataOk: true, data: { records: null, rowCount: 0, pageCount: 0 } },
    ];
  });

  it('paginates the official course list, filters by current term and deduplicates course IDs', async () => {
    const current = { acteId: '11', teclId: '9000', subjCode: null, subjName: '测试课程' };
    server.replies.push(
      {
        ok: true,
        dataOk: true,
        data: {
          records: [
            { ...current, acteId: 10, teclId: 8999 },
            current,
            { ...current, acteId: 12, teclId: 9001 },
          ],
          pageCount: 2,
        },
      },
      {
        ok: true,
        dataOk: true,
        data: { records: [current, { ...current, teclId: 9002, subjCode: 'TEST' }], pageCount: 2 },
      },
    );
    await expect(listCourses()).resolves.toEqual([
      { id: 9000, code: '', name: '测试课程' },
      { id: 9002, code: 'TEST', name: '测试课程' },
    ]);
    expect(server.urls).toHaveLength(5);
    for (const [index, value] of server.urls.slice(3).entries()) {
      const url = new URL(value);
      expect(url.pathname).toBe('/jy-application-resourcemanage/v1/group_subject_vod_list/t-1');
      expect(url.searchParams.get('page.pageIndex')).toBe(String(index + 1));
      expect(url.searchParams.get('page.pageSize')).toBe('1000');
      expect(url.searchParams.get('page.orders[0].asc')).toBe('false');
      expect(url.searchParams.get('page.orders[0].field')).toBe('courBeginTime');
    }
  });

  it('returns no courses when on-demand courses belong only to older terms', async () => {
    server.replies.push({
      ok: true,
      data: { records: [{ acteId: 10, teclId: 9000, subjName: '旧课程' }], pageCount: 1 },
    });
    await expect(listCourses()).resolves.toEqual([]);
  });

  it.each([
    { teclId: 9000, subjName: '缺少学期' },
    { acteId: null, teclId: 9000, subjName: '无效学期' },
    { acteId: 11, teclId: 'invalid', subjName: '无效课程编号' },
    { acteId: 11, teclId: 9000 },
  ])('rejects incomplete on-demand course metadata (%j)', async (course) => {
    server.replies.push({ ok: true, data: { records: [course], pageCount: 1 } });
    await expect(listCourses()).rejects.toThrow('数据格式已变化');
  });

  it.each([
    [{ ok: false, data: { records: [] } }, '接口请求失败'],
    [{ ok: true, dataOk: false, data: { records: [] } }, '接口请求失败'],
    [{ code: '-1', data: null }, '登录'],
    [{ ok: true, data: { unexpected: [] } }, '列表数据格式已变化'],
  ] as const)(
    'reports fallback errors instead of presenting an empty list (%j)',
    async (reply, error) => {
      server.replies.push(reply);
      await expect(listCourses()).rejects.toThrow(error);
      expect(server.urls).toHaveLength(4);
    },
  );

  it.each([
    { ok: false, data: { records: [], pageCount: 0 } },
    { ok: true, dataOk: false, data: { records: [], pageCount: 0 } },
  ])(
    'does not fall back after the curriculum reports failure with an empty array (%j)',
    async (reply) => {
      server.replies[2] = reply;
      await expect(listCourses()).rejects.toThrow('接口请求失败');
      expect(server.urls).toHaveLength(3);
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

it('rejects missing streams without guessing the cause and retains validation details', () => {
  expect(() => parseStreams({ courseVodViewList: null })).toThrow(
    expect.objectContaining({
      message: '暂未获取到可播放录像，请稍后重试',
      cause: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['courseVodViewList'], code: 'invalid_type' }),
        ]),
      }),
    }),
  );
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
