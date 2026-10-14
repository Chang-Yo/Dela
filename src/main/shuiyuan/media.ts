import { loadShuiyuanCredential } from '../credentials';
import { getCampusSession } from '../campus';

const SHUIYUAN_ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
const MEDIA_TIMEOUT_MS = 20000;

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
 * 处理 dela-resource://shuiyuan/<同站媒体路径>：楼层 HTML 里的 /uploads 等
 * 地址匿名加载会被登录墙拦下。通道一使用已恢复的 campus Session 及其 Discourse
 * cookie，失效时回退通道二 User API Key 头。
 * 全程不抛错：两通道都失败最终落回 404，图片破图但不影响楼层渲染。
 */
export async function handleShuiyuanMediaRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 404 });
    }
    const url = new URL(request.url);
    // 目标域名固定写死且最终响应必须是媒体，因此无需猜测 Discourse 的静态路径。
    // 只拒绝双斜线路径，避免它在 URL 重新解析时被当成 scheme-relative host。
    if (
      url.hostname !== 'shuiyuan' ||
      !url.pathname.startsWith('/') ||
      url.pathname.startsWith('//')
    ) {
      return new Response(null, { status: 404 });
    }
    const target = new URL(`${url.pathname}${url.search}`, SHUIYUAN_ORIGIN).href;
    const attempts: Array<() => Promise<Response>> = [];
    try {
      const campus = await getCampusSession();
      attempts.push(() =>
        campus.fetch(target, {
          credentials: 'include',
          method: request.method,
          signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
        }),
      );
    } catch {
      // 会话快照不可用时仍允许 User API Key 通道继续尝试。
    }
    try {
      const credential = loadShuiyuanCredential();
      if (credential) {
        attempts.push(() =>
          fetch(target, {
            headers: {
              'User-Api-Key': credential.key,
              'User-Api-Client-Id': credential.clientId,
            },
            method: request.method,
            signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
          }),
        );
      }
    } catch {
      // 本地凭据不可读时仍保留前面的 campus Session 通道。
    }
    for (const attempt of attempts) {
      try {
        const response = await attempt();
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
