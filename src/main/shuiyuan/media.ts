import { loadShuiyuanCredential } from '../credentials';

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
 * 处理 dela-resource://shuiyuan/<同站媒体路径>：楼层 HTML 里的 /secure-uploads 等
 * 地址匿名加载会被登录墙拦下，由主进程带 User API Key 头取回。
 * 全程不抛错：失败落回 404，图片破图但不影响楼层渲染。
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
    const credential = loadShuiyuanCredential();
    if (!credential) return new Response(null, { status: 404 });
    const response = await fetch(new URL(`${url.pathname}${url.search}`, SHUIYUAN_ORIGIN).href, {
      headers: {
        'User-Api-Key': credential.key,
        'User-Api-Client-Id': credential.clientId,
      },
      method: request.method,
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (response.ok && isMediaResponse(response)) return mediaResponse(response);
  } catch {
    // 兜底：网络错误、超时与凭据不可读都不允许让 protocol.handle 的 handler 抛错。
  }
  return new Response(null, { status: 404 });
}
