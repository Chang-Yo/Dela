// 课堂视频在线播放代理：dela-resource://vsjtu/video/<videoId>/<view>?t=<token>。
// 签名媒体地址与校园 cookie 都留在 main，renderer 只拿不透明的播放地址；
// token 挡住 renderer 里远程内容（邮件 HTML 等）按可猜测的 videoId 盗播。
// 拖拽进度条依赖 Range：原样转发给 live.sjtu.edu.cn 并透传 206。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { savedExperimentalClassroom, savedExperimentalFeatures } from '../settings/prefs';
import { getCampusSession } from '../campus';
import { getStreams } from './api';

const URL_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 32;
const NETWORK_TIMEOUT_MS = 15000;
const playbackKey = randomBytes(32);

// 授权凭据在本次应用运行期间有效，不随签名缓存淘汰而失效。
function playbackToken(videoId: number): string {
  return createHmac('sha256', playbackKey).update(String(videoId)).digest('hex').slice(0, 32);
}

interface PlaybackEntry {
  streams: Array<{ view: number; duration: number; url: string }>;
  resolvedAt: number;
  usedAt: number;
}

// 只限制签名元数据缓存；淘汰最久未用的条目，不撤销已签发的播放凭据。
const entries = new Map<number, PlaybackEntry>();
const resolving = new Map<number, Promise<PlaybackEntry>>();

export interface PlaybackStream {
  view: number;
  duration: number;
  playbackUrl: string;
}

async function streamsOf(videoId: number, force = false): Promise<PlaybackEntry> {
  const pending = resolving.get(videoId);
  if (pending) return pending;
  const cached = entries.get(videoId);
  if (!force && cached && Date.now() - cached.resolvedAt < URL_TTL_MS) {
    cached.usedAt = Date.now();
    return cached;
  }
  const task = (async () => {
    try {
      const streams = await getStreams(videoId);
      if (streams.length === 0) throw new Error('录像画面尚未就绪，请稍后重试');
      const entry = { streams, resolvedAt: Date.now(), usedAt: Date.now() };
      entries.set(videoId, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].reduce((a, b) => (a.usedAt <= b.usedAt ? a : b));
        for (const [key, value] of entries) if (value === oldest) entries.delete(key);
      }
      return entry;
    } finally {
      resolving.delete(videoId);
    }
  })();
  resolving.set(videoId, task);
  return task;
}

/** streams IPC 入口：返回带播放地址的画面列表（地址含 token，renderer 不解析）。 */
export async function issuePlayback(videoId: number): Promise<PlaybackStream[]> {
  const entry = await streamsOf(videoId);
  return entry.streams.map((stream) => ({
    view: stream.view,
    duration: stream.duration,
    playbackUrl: `dela-resource://vsjtu/video/${videoId}/${stream.view}?t=${playbackToken(videoId)}`,
  }));
}

// 只透传媒体需要的头；上游 set-cookie 等一律不转发。
const passHeaders = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

export async function handleVsjtuMediaRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 });
    if (!savedExperimentalFeatures() || !savedExperimentalClassroom())
      return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const match = /^\/video\/(\d+)\/(\d+)$/.exec(url.pathname);
    const token = url.searchParams.get('t');
    const videoId = match ? Number(match[1]) : 0;
    if (
      url.hostname !== 'vsjtu' ||
      !match ||
      !token ||
      !/^[0-9a-f]{32}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(playbackToken(videoId)))
    )
      return new Response(null, { status: 403 });
    const view = Number(match[2]);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      request.signal.throwIfAborted();
      const entry = await streamsOf(videoId);
      const stream = entry.streams.find((value) => value.view === view);
      if (!stream) return new Response(null, { status: 404 });
      try {
        response = await fetchUp(stream.url, request);
      } catch (error) {
        if (request.signal.aborted || attempt === 1) throw error;
        await delay(250, undefined, { signal: request.signal });
        continue;
      }
      if (attempt === 0 && (response.status === 401 || response.status === 403)) {
        await response.body?.cancel();
        // 其他 Range 可能已更新签名，避免每个旧请求各自重取。
        if (entries.get(videoId) === entry) await streamsOf(videoId, true);
        continue;
      }
      if (attempt === 0 && [408, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await delay(250, undefined, { signal: request.signal });
        continue;
      }
      break;
    }
    if (!response) return new Response(null, { status: 502 });
    if (![200, 206, 416].includes(response.status)) {
      await response.body?.cancel();
      return new Response(null, { status: 502 });
    }
    const headers = new Headers({
      'cache-control': 'no-store',
      'content-type': response.headers.get('content-type') ?? 'video/mp4',
      'x-content-type-options': 'nosniff',
    });
    for (const name of passHeaders) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (response.status === 416) headers.set('content-length', '0');
    if (request.method === 'HEAD' || response.status === 416) await response.body?.cancel();
    return new Response(
      request.method === 'HEAD' || response.status === 416 ? null : response.body,
      {
        status: response.status,
        headers,
      },
    );
  } catch (error) {
    return new Response(null, {
      status: error instanceof Error && error.name === 'TimeoutError' ? 504 : 502,
    });
  }
}

async function fetchUp(target: string, request: Request): Promise<Response> {
  const campus = await getCampusSession();
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timeout = () =>
    setTimeout(
      () => controller.abort(new DOMException('视频响应超时', 'TimeoutError')),
      NETWORK_TIMEOUT_MS,
    );
  const headers = new Headers();
  for (const name of ['range', 'if-range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const timer = timeout();
  let response: Response;
  try {
    response = await campus.fetch(target, {
      method: request.method,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      signal,
    });
  } catch (error) {
    throw signal.aborted ? signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, { status: response.status, headers: response.headers });
  }
  const reader = response.body?.getReader();
  if (!reader) return response;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(output) {
        // 仅在下游需要数据时计时；暂停播放造成的背压不算网络超时。
        const timer = timeout();
        try {
          const chunk = await reader.read();
          if (chunk.done) output.close();
          else output.enqueue(chunk.value);
        } catch (error) {
          controller.abort();
          output.error(error);
        } finally {
          clearTimeout(timer);
        }
      },
      cancel(reason) {
        controller.abort();
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: response.status, headers: response.headers });
}
