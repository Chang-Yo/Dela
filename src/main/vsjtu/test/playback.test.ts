import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({ fetch: vi.fn(), streams: vi.fn() }));
vi.mock('node:timers/promises', () => ({
  setTimeout: async (_ms: number, _value: unknown, { signal }: { signal: AbortSignal }) =>
    signal.throwIfAborted(),
}));
vi.mock('../../campus', () => ({
  getCampusSession: async () => ({ fetch: upstream.fetch }),
}));
vi.mock('../api', () => ({ getStreams: upstream.streams }));
import { handleVsjtuMediaRequest, issuePlayback } from '../playback';

let videoId = 100;
beforeEach(() => {
  videoId++;
  vi.resetAllMocks();
  upstream.streams.mockResolvedValue([
    { view: 1, duration: 3000, url: 'https://live.sjtu.edu.cn/lecture.mp4?key=private' },
  ]);
});
afterEach(() => vi.useRealTimers());

async function mediaRequest(init?: RequestInit) {
  const [stream] = await issuePlayback(videoId);
  return handleVsjtuMediaRequest(new Request(stream!.playbackUrl, init));
}

it('shares concurrent source lookups so every returned playback token remains usable', async () => {
  const [first, second] = await Promise.all([issuePlayback(videoId), issuePlayback(videoId)]);
  expect(first[0]!.playbackUrl).toBe(second[0]!.playbackUrl);
  expect(upstream.streams).toHaveBeenCalledTimes(1);
});

it('does not cache an empty source list and allows a later retry when the recording is ready', async () => {
  upstream.streams.mockResolvedValueOnce([]);
  await expect(issuePlayback(videoId)).rejects.toThrow('暂未获取到可播放录像，请稍后重试');
  expect(await issuePlayback(videoId)).toHaveLength(1);
  expect(upstream.streams).toHaveBeenCalledTimes(2);
});

it('can reopen a renderer-cached playback URL after the source cache is evicted', async () => {
  const [first] = await issuePlayback(videoId);
  for (let index = 0; index < 33; index++) await issuePlayback(10000 + index);
  upstream.fetch.mockResolvedValue(new Response('video'));
  const response = await handleVsjtuMediaRequest(new Request(first!.playbackUrl));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('video');
});

it('aborts upstream when a seek cancels the returned response body', async () => {
  let signal: AbortSignal | undefined;
  upstream.fetch.mockImplementation(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ pull() {} }));
  });
  const response = await mediaRequest({ headers: { range: 'bytes=100-' } });
  await response.body!.cancel();
  expect(signal?.aborted).toBe(true);
  expect(upstream.fetch.mock.calls[0]![1].cache).toBe('no-store');
});

it('retries a temporary upstream failure while preserving the requested byte range', async () => {
  upstream.fetch.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(
    new Response(new Uint8Array([1, 2]), {
      status: 206,
      headers: { 'content-range': 'bytes 100-101/200', 'content-length': '2' },
    }),
  );
  const response = await mediaRequest({ headers: { range: 'bytes=100-101' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 100-101/200');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2]);
  expect(
    upstream.fetch.mock.calls.map((call) => new Headers(call[1].headers).get('range')),
  ).toEqual(['bytes=100-101', 'bytes=100-101']);
});

it('forwards HEAD without starting a full GET and preserves unsatisfied-range metadata', async () => {
  upstream.fetch.mockResolvedValue(
    new Response(null, {
      status: 416,
      headers: { 'content-range': 'bytes */200' },
    }),
  );
  const response = await mediaRequest({ method: 'HEAD', headers: { range: 'bytes=999-' } });
  expect(upstream.fetch.mock.calls[0]![1].method).toBe('HEAD');
  expect(response.status).toBe(416);
  expect(response.headers.get('content-range')).toBe('bytes */200');
  expect(response.body).toBeNull();
});

it('times out an upstream that never sends headers, with a bounded retry', async () => {
  vi.useFakeTimers();
  upstream.fetch.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const pending = mediaRequest();
  await vi.advanceTimersByTimeAsync(60000);
  expect((await pending).status).toBe(504);
  expect(upstream.fetch).toHaveBeenCalledTimes(2);
});

it('ends a stalled response body instead of leaving the player waiting indefinitely', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  upstream.fetch.mockImplementation(async (_url, options) => {
    signal = options.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal!.addEventListener('abort', () => controller.error(signal!.reason), { once: true });
        },
      }),
    );
  });
  const response = await mediaRequest();
  const result = response.arrayBuffer().then(
    () => 'completed',
    () => 'failed',
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(await result).toBe('failed');
  expect(signal?.aborted).toBe(true);
});

it('does not treat downstream backpressure as an upstream read timeout', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  upstream.fetch.mockImplementation(async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ pull() {} }));
  });
  const response = await mediaRequest();
  await vi.advanceTimersByTimeAsync(60000);
  expect(signal?.aborted).toBe(false);
  await response.body!.cancel();
});

it('rejects forged tokens before resolving sources or contacting the media host', async () => {
  const response = await handleVsjtuMediaRequest(
    new Request(`dela-resource://vsjtu/video/${videoId}/1?t=${'0'.repeat(32)}`),
  );
  expect(response.status).toBe(403);
  expect(upstream.streams).not.toHaveBeenCalled();
  expect(upstream.fetch).not.toHaveBeenCalled();
});

it('shares a signature refresh across concurrent expired Range requests', async () => {
  const [stream] = await issuePlayback(videoId);
  upstream.streams.mockResolvedValue([
    { view: 1, duration: 3000, url: 'https://live.sjtu.edu.cn/lecture.mp4?key=renewed' },
  ]);
  upstream.fetch.mockImplementation(async (url) =>
    url.includes('renewed') ? new Response('ok') : new Response(null, { status: 403 }),
  );
  const responses = await Promise.all(
    [1, 2].map(() => handleVsjtuMediaRequest(new Request(stream!.playbackUrl))),
  );
  expect(await Promise.all(responses.map((response) => response.text()))).toEqual(['ok', 'ok']);
  expect(upstream.streams).toHaveBeenCalledTimes(2);
});

it('does not retry a request cancelled by the player', async () => {
  const controller = new AbortController();
  upstream.fetch.mockImplementation(async () => {
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  await mediaRequest({ signal: controller.signal });
  expect(upstream.fetch).toHaveBeenCalledTimes(1);
});
