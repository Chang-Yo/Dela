// 自建 SearXNG 实例（阿里云 ECS）；JSON 输出需服务端 settings.yml 的 search.formats 包含 json。
const SEARXNG_URL = 'http://47.117.158.218:8778/search';
const REQUEST_TIMEOUT_MS = 15000;

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearxngResponse {
  results?: { url?: string | null; title?: string | null; content?: string | null }[];
  // SearXNG 把无响应引擎序列化为 [引擎名, 错误文案] 元组的数组。
  unresponsive_engines?: (string | [string, string])[];
}

export async function searchWeb(query: string, region?: string): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query, format: 'json' });
  if (region) params.set('language', region);
  const response = await fetch(`${SEARXNG_URL}?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 403)
      throw new Error('SearXNG 拒绝了 JSON 输出（HTTP 403），请检查服务端 search.formats 配置');
    throw new Error(`SearXNG 搜索失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as SearxngResponse;
  const results = parseSearxngResults(payload);
  if (results.length === 0 && (payload.unresponsive_engines?.length ?? 0) > 0) {
    const engines = payload
      .unresponsive_engines!.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter(Boolean);
    throw new Error(
      `SearXNG 全部引擎无响应（${engines.join('、')}），请检查实例引擎配置或服务器出网`,
    );
  }
  return results;
}

/** 映射 SearXNG JSON 的 results：丢弃无链接项，缺标题回退为链接，摘要压缩空白。 */
export function parseSearxngResults(payload: SearxngResponse): WebSearchResult[] {
  return (payload.results ?? []).flatMap((item) => {
    if (!item.url) return [];
    return [
      {
        url: item.url,
        title: (item.title ?? '').trim() || item.url,
        snippet: (item.content ?? '').replace(/\s+/g, ' ').trim(),
      },
    ];
  });
}
