import { net, session } from 'electron';
import { loadShuiyuanCredential } from '../credentials';
import { CAMPUS_PARTITION } from '../timetable/session';

const SHUIYUAN_ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
const MEDIA_TIMEOUT_MS = 20000;
// 可代理的媒体路径白名单，防止 dela-resource://shuiyuan 被当成任意页面代理。
const MEDIA_PATH_PREFIXES = ['/uploads/', '/images/', '/user_avatar/', '/letter_avatar/'];

// 水源全站强制登录，登录墙会把匿名请求 302 到登录页并以 200 返回 HTML，
// 不能只看 response.ok，必须按 content-type 判定拿到的是不是媒体。
function isMediaResponse(response: Response): boolean {
  return /^(image|video|audio)\//i.test(response.headers.get('content-type') ?? '');
}

// 重建 Response：只透传 content-type，不转发上游 set-cookie 等头。
function mediaResponse(response: Response): Response {
  const headers = new Headers({
    'cache-control': 'private, max-age=86400',
    'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  return new Response(response.body, { status: response.status, headers });
}

/**
 * 从 campus Session 的 cookie store 显式取出 cookie 拼成 Cookie 头。不能依赖
 * session.fetch 的 credentials: 'include'：那是无 initiator 的程序化请求，
 * Chromium 的 SameSite 规则不随其发送 Lax cookie，而水源的 _t/_forum_session
 * 正是 Lax——显式头是唯一稳定携带方式（net.fetch 允许自定义 Cookie 头）。
 */
async function cookieHeaderFor(): Promise<string | null> {
  try {
    const cookies = await session
      .fromPartition(CAMPUS_PARTITION)
      .cookies.get({ url: SHUIYUAN_ORIGIN });
    if (cookies.length === 0) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  } catch {
    return null;
  }
}

/**
 * 处理 dela-resource://shuiyuan/<同站媒体路径>：楼层 HTML 里的 /uploads 等
 * 地址匿名加载会被登录墙拦下。通道一手动携带 jAccount 登录种下的 Discourse
 * cookie（与课表共用 campus Session），失效时回退通道二 User API Key 头。
 * 全程不抛错：两通道都失败最终落回 404，图片破图但不影响楼层渲染。
 */
export async function handleShuiyuanMediaRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 404 });
    }
    const url = new URL(request.url);
    if (
      url.hostname !== 'shuiyuan' ||
      !MEDIA_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      return new Response(null, { status: 404 });
    }
    const target = `${SHUIYUAN_ORIGIN}${url.pathname}${url.search}`;
    const attempts: Array<Record<string, string>> = [];
    const cookieHeader = await cookieHeaderFor();
    if (cookieHeader) attempts.push({ Cookie: cookieHeader });
    const credential = loadShuiyuanCredential();
    if (credential) {
      attempts.push({
        'User-Api-Key': credential.key,
        'User-Api-Client-Id': credential.clientId,
      });
    }
    for (const headers of attempts) {
      try {
        const response = await net.fetch(target, {
          credentials: 'omit',
          headers,
          signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
        });
        if (response.ok && isMediaResponse(response)) return mediaResponse(response);
      } catch {
        // 本通道失败（网络错误/超时/登录墙），换下一通道。
      }
    }
  } catch {
    // 兜底：不允许让 protocol.handle 的 handler 抛错。
  }
  return new Response(null, { status: 404 });
}
