import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({ request: vi.fn(), watch: vi.fn() }));
vi.mock('../../campus', () => ({
  campusRequest: server.request,
  getCampusSession: async () => ({ cookies: { on: server.watch } }),
}));
vi.mock('../../credentials', () => ({ loadCanvasToken: () => null }));
vi.mock('../../canvas/api', () => ({ classroomLoginUrl: vi.fn() }));

const identity = { code: '0', result: { user: { code: 'test-user' } } };
const data = { afterAssemblyList: [{ bg: 1250, ed: 3600500, res: '测试文稿' }] };
let payload: unknown;
let api: typeof import('../api');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  payload = { code: null, status: 200, ok: true, dataOk: true, data };
  server.request.mockImplementation(async (_session, url: string) =>
    JSON.stringify(url.endsWith('/me') ? identity : payload),
  );
  api = await import('../api');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const reads = () =>
  server.request.mock.calls.filter(([, url]) => String(url).includes('/translate/')).length;
const changeSession = () => server.watch.mock.calls[0]![1]({}, { domain: 'v.sjtu.edu.cn' });

it('shares concurrent requests, preserves millisecond timestamps and exports plain text', async () => {
  const [transcript] = await Promise.all([api.getTranscript(12), api.getTranscript(12)]);
  expect(transcript).toEqual({
    videoId: 12,
    segments: [{ startMs: 1250, endMs: 3600500, text: '测试文稿' }],
  });
  expect(reads()).toBe(1);
  expect(server.request.mock.calls[0]![1]).toBe(
    'https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/translate/12?useOriginal=true',
  );
  expect(api.formatTranscript(transcript!, '课程 · 第 1 节')).toBe(
    '课程 · 第 1 节\n录像 ID：12\n\n[00:00:01.250–01:00:00.500] 测试文稿\n',
  );
  transcript!.segments[0]!.text = '调用方修改';
  expect((await api.getTranscript(12))!.segments[0]!.text).toBe('测试文稿');
});

it('does not cache absent transcripts or confuse service and schema failures with absence', async () => {
  for (const empty of [null, { afterAssemblyList: [] }]) {
    payload = { code: null, status: 200, ok: true, dataOk: empty !== null, data: empty };
    expect(await api.getTranscript(12)).toBeNull();
    expect(await api.getTranscript(12)).toBeNull();
  }
  expect(reads()).toBe(4);
  for (const invalid of [
    { code: '-1', status: 200, ok: true, data: null },
    { code: null, status: 500, ok: false, data: null },
    { ok: true, data: {} },
    { ok: true, data: { afterAssemblyList: [{ bg: null, ed: 10, res: '无效时间' }] } },
    { ok: true, data: { afterAssemblyList: [{ bg: 10, ed: 1, res: '倒序时间' }] } },
  ]) {
    payload = invalid;
    await expect(api.getTranscript(12)).rejects.toThrow();
  }
});

it('keeps only the latest transcript and releases it after five minutes', async () => {
  await api.getTranscript(12);
  await api.getTranscript(12);
  expect(reads()).toBe(1);
  await api.getTranscript(13);
  await api.getTranscript(12);
  expect(reads()).toBe(3);
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  await api.getTranscript(12);
  expect(reads()).toBe(4);
});

it('returns a large transcript without retaining it in the cache', async () => {
  payload = { ok: true, data: { afterAssemblyList: [{ bg: 0, ed: 1, res: '文'.repeat(400000) }] } };
  expect((await api.getTranscript(12))!.segments[0]!.text).toHaveLength(400000);
  await api.getTranscript(12);
  expect(reads()).toBe(2);
});

it('checks authentication before cache hits and clears the cache on failure', async () => {
  await api.getTranscript(12);
  server.request.mockResolvedValueOnce(JSON.stringify({ code: '-1', result: null }));
  await expect(api.getTranscript(12)).rejects.toThrow('登录');
  await api.getTranscript(12);
  expect(reads()).toBe(2);
});

it('invalidates the cached transcript when the campus session changes', async () => {
  await api.getTranscript(12);
  changeSession();
  await api.getTranscript(12);
  expect(reads()).toBe(2);
});

it('refetches with the new session when the session changes during a read', async () => {
  server.request.mockImplementationOnce(async () => {
    changeSession();
    return JSON.stringify(payload);
  });
  expect((await api.getTranscript(12))!.segments[0]!.text).toBe('测试文稿');
  expect(reads()).toBe(2);
});
