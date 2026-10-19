// DeepSeek 官方 Search / Fetch 接口：Bearer 鉴权、按成功请求计费（5 元 / 千次，QPS 5），
// 与 OpenAI 兼容的 chat 端点无关。Search 返回结构化网页，Fetch 返回 Markdown 正文。
const BASE_URL = 'https://api.deepseek.com';
const REQUEST_TIMEOUT_MS = 15000;

export class DeepSeekError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, apiKey: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DeepSeekError(
      response.status,
      `DeepSeek 请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`,
    );
  }
  return (await response.json()) as T;
}

const compact = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

export interface DeepSeekSearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索结果取标题、链接与长摘要：官方 summary（600–800 字）面向模型阅读，
 *  snippet（100–200 字）面向前端展示，WebSearch 的消费者是模型。 */
export async function searchDeepSeek(
  query: string,
  count: number,
  apiKey: string,
): Promise<DeepSeekSearchHit[]> {
  const payload = await post<{
    results?: {
      title?: string | null;
      url?: string | null;
      summary?: string | null;
    }[];
  }>('/v1/tools/search', { query, count }, apiKey);
  return (payload.results ?? [])
    .flatMap((item) =>
      item.url
        ? [
            {
              url: item.url,
              title: compact(item.title) || item.url,
              snippet: compact(item.summary),
            },
          ]
        : [],
    )
    .slice(0, count);
}

/** 抓取单页正文，返回标题与 Markdown；取不到正文时抛 DeepSeekError（404）。 */
export async function fetchDeepSeek(
  url: string,
  apiKey: string,
): Promise<{ title: string | null; text: string }> {
  const payload = await post<{ title?: string | null; content?: string | null }>(
    '/v1/tools/fetch',
    { url },
    apiKey,
  );
  return { title: compact(payload.title) || null, text: payload.content ?? '' };
}
