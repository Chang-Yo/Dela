// 课堂视频在线播放代理：dela-resource://vsjtu/video/<videoId>/<view>?t=<token>。
// 签名媒体地址与校园 cookie 都留在 main，renderer 只拿不透明的播放地址；
// token 挡住 renderer 里远程内容（邮件 HTML 等）按可猜测的 videoId 盗播。
// 拖拽进度条依赖 Range：原样转发给 live.sjtu.edu.cn 并透传 206。
import { randomBytes } from 'node:crypto';
import { savedExperimentalClassroom, savedExperimentalFeatures } from '../settings/prefs';
import { getCampusSession } from '../timetable/session';
import { getStreams } from './api';

const URL_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 32;

interface PlaybackEntry {
  token: string;
  streams: Array<{ view: number; duration: number; url: string }>;
  resolvedAt: number;
  usedAt: number;
}

// insertion order 即 LRU：读命中重新 set，超量淘汰最久未用。
const entries = new Map<number, PlaybackEntry>();

export interface PlaybackStream {
  view: number;
  duration: number;
  playbackUrl: string;
}

async function streamsOf(videoId: number, force = false): Promise<PlaybackEntry> {
  const cached = entries.get(videoId);
  if (!force && cached && Date.now() - cached.resolvedAt < URL_TTL_MS) {
    cached.usedAt = Date.now();
    return cached;
  }
  const streams = await getStreams(videoId);
  // 刷新签名地址时保留原 token：播放中途的后续 Range 请求仍用旧地址，不能被打断。
  const entry: PlaybackEntry = cached ?? {
    token: randomBytes(16).toString('hex'),
    streams: [],
    resolvedAt: 0,
    usedAt: 0,
  };
  entry.streams = streams.map((stream) => ({
    view: stream.view,
    duration: stream.duration,
    url: stream.url,
  }));
  entry.resolvedAt = Date.now();
  entry.usedAt = Date.now();
  entries.set(videoId, entry);
  if (entries.size > MAX_ENTRIES) {
    const oldest = [...entries.values()].reduce((a, b) => (a.usedAt <= b.usedAt ? a : b));
    for (const [key, value] of entries) if (value === oldest) entries.delete(key);
  }
  return entry;
}

/** streams IPC 入口：返回带播放地址的画面列表（地址含 token，renderer 不解析）。 */
export async function issuePlayback(videoId: number): Promise<PlaybackStream[]> {
  const entry = await streamsOf(videoId);
  return entry.streams.map((stream) => ({
    view: stream.view,
    duration: stream.duration,
    playbackUrl: `dela-resource://vsjtu/video/${videoId}/${stream.view}?t=${entry.token}`,
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
    const entry = match ? entries.get(videoId) : undefined;
    if (!match || !token || !entry || entry.token !== token)
      return new Response(null, { status: 403 });
    entry.usedAt = Date.now();
    const view = Number(match[2]);
    const stream = entry.streams.find((value) => value.view === view);
    if (!stream) return new Response(null, { status: 404 });
    const range = request.headers.get('range');
    let response = await fetchUp(stream.url, range, request.signal);
    // 签名地址过期（401/403）：强制重取一次再试，避免播放中途断流。
    if (response.status === 401 || response.status === 403) {
      response.body?.cancel();
      const fresh = await streamsOf(videoId, true);
      const retry = fresh.streams.find((value) => value.view === view);
      if (!retry) return new Response(null, { status: 404 });
      response = await fetchUp(retry.url, range, request.signal);
    }
    if (response.status !== 200 && response.status !== 206) {
      response.body?.cancel();
      return new Response(null, { status: response.status === 416 ? 416 : 404 });
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
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function fetchUp(
  target: string,
  range: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const campus = await getCampusSession();
  return campus.fetch(target, {
    credentials: 'include',
    headers: range ? { range } : undefined,
    // 直接复用协议请求的 signal：video 元素 seek 取消当前 Range 请求时同步中止上游。
    signal,
  });
}
