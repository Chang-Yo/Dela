import { z } from 'zod';
import { getDatabase } from '../../../database';
import type { WebSearchConfig } from '../../../../shared/capabilities';
import { tool } from '../shared';

// 搜索服务注册（设置 › 内置能力 › 网络）：同一时刻至多一个生效，应用不内置搜索服务。
const CONFIG_KEY = 'web-search-api';
const REQUEST_TIMEOUT_MS = 15000;

// 请求头键限 HTTP token 字符；条数封顶防滥用。
const headerKeySchema = z.string().regex(/^[\w!#$%&'*+\-.^`|~]{1,128}$/);
const headersSchema = z
  .record(headerKeySchema, z.string().min(1).max(2048))
  .refine((headers) => Object.keys(headers).length <= 32, '自定义请求头最多 32 条');

export const webSearchConfigSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('brave'), apiKey: z.string().trim().min(1).max(256) }).strict(),
  z
    .object({
      provider: z.literal('google'),
      apiKey: z.string().trim().min(1).max(256),
      cx: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      provider: z.literal('custom'),
      url: z.string().url().max(2048),
      headers: headersSchema.optional(),
    })
    .strict(),
]);

export function readWebSearchConfig(): WebSearchConfig | null {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(CONFIG_KEY) as { value: string } | undefined;
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    // 上一迭代短暂引入过 brave.endpoint 字段：读取时剥离，避免 strict 校验拒绝。
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { provider?: string }).provider === 'brave'
    )
      delete (parsed as { endpoint?: unknown }).endpoint;
    const current = webSearchConfigSchema.safeParse(parsed);
    if (current.success) return current.data;
    // 旧版仅存 { url }（SearXNG 端点）：迁移为自定义端点。
    const legacy = z
      .object({ url: z.string().url().max(2048) })
      .strict()
      .safeParse(parsed);
    return legacy.success ? { provider: 'custom', url: legacy.data.url } : null;
  } catch {
    return null;
  }
}

export function writeWebSearchConfig(config: WebSearchConfig | null): WebSearchConfig | null {
  const db = getDatabase();
  if (config === null) {
    db.prepare('DELETE FROM workspace_settings WHERE key=?').run(CONFIG_KEY);
    return null;
  }
  const normalized = webSearchConfigSchema.parse(config);
  db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
    CONFIG_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function searchError(status: number): Error {
  if (status === 401 || status === 403)
    return new Error(`搜索服务认证失败（HTTP ${status}），请检查 API Key 或端点配置`);
  return new Error(`搜索失败（HTTP ${status}）`);
}

const compact = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

// Brave 固定走为大模型设计的 LLM Context 端点：grounding.generic（普通网页）
// 与 map/poi（本地召回）同构，均为 { url, title, snippets[] }，snippets 是
// 从页面抽取的内容片段而非搜索摘要。
async function searchBrave(
  query: string,
  count: number,
  freshness: string | undefined,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(count) });
  if (freshness) params.set('freshness', freshness);
  const response = await fetch(`https://api.search.brave.com/res/v1/llm/context?${params}`, {
    headers: { accept: 'application/json', 'x-subscription-token': apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    grounding?: {
      generic?: { url?: string | null; title?: string | null; snippets?: string[] }[];
      map?: { url?: string | null; title?: string | null; snippets?: string[] }[];
      poi?: { url?: string | null; title?: string | null; snippets?: string[] } | null;
    };
  };
  const groups = [
    ...(payload.grounding?.generic ?? []),
    ...(payload.grounding?.map ?? []),
    ...(payload.grounding?.poi ? [payload.grounding.poi] : []),
  ];
  return groups.flatMap((item) =>
    item.url
      ? [
          {
            url: item.url,
            title: compact(item.title) || item.url,
            snippet: compact((item.snippets ?? []).join(' ')),
          },
        ]
      : [],
  );
}

async function searchGoogle(
  query: string,
  count: number,
  apiKey: string,
  cx: string,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(count) });
  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    items?: { title?: string | null; link?: string | null; snippet?: string | null }[];
  };
  return (payload.items ?? []).flatMap((item) =>
    item.link
      ? [
          {
            url: item.link,
            title: compact(item.title) || item.link,
            snippet: compact(item.snippet),
          },
        ]
      : [],
  );
}

// 自定义端点：SearXNG 兼容 JSON（{ results: [{ title, url, content }] }）；
// 注册的自定义请求头随请求发送（适配用户自备的鉴权/加密策略），可覆盖默认 accept。
async function searchCustomEndpoint(
  query: string,
  endpoint: string,
  headers: Record<string, string> | undefined,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query, format: 'json' });
  const response = await fetch(`${endpoint}?${params}`, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    results?: { url?: string | null; title?: string | null; content?: string | null }[];
    // SearXNG 把无响应引擎序列化为 [引擎名, 错误文案] 元组的数组。
    unresponsive_engines?: (string | [string, string])[];
  };
  const results = (payload.results ?? []).flatMap((item) =>
    item.url
      ? [{ url: item.url, title: compact(item.title) || item.url, snippet: compact(item.content) }]
      : [],
  );
  if (results.length === 0 && (payload.unresponsive_engines?.length ?? 0) > 0) {
    const engines = payload
      .unresponsive_engines!.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter(Boolean);
    throw new Error(`搜索服务全部引擎无响应（${engines.join('、')}），请检查实例配置`);
  }
  return results;
}

export const webSearchTool = tool(
  '联网搜索网页，返回标题、链接和摘要；只读。中英文均可。需先在设置 › 内置能力的「网络」分组注册搜索服务（Brave / Google / 自定义端点）。注册为 Brave 时结果来自 Brave LLM Context：snippet 是从页面抽取的内容片段，信息量接近正文，通常无需再对链接调用 WebFetch。freshness 仅 Brave 生效，其余服务忽略该参数。',
  z
    .object({
      query: z.string().trim().min(1).max(400),
      count: z.number().int().min(1).max(10).default(5),
      freshness: z
        .string()
        .regex(/^(pd|pw|pm|py|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/)
        .optional(),
    })
    .strict(),
  async ({ query, count, freshness }) => {
    const config = readWebSearchConfig();
    if (!config) throw new Error('尚未注册搜索服务：请在 设置 › 内置能力 的「网络」分组中配置');
    const results =
      config.provider === 'brave'
        ? await searchBrave(query, count, freshness, config.apiKey)
        : config.provider === 'google'
          ? await searchGoogle(query, count, config.apiKey, config.cx)
          : await searchCustomEndpoint(query, config.url, config.headers);
    return { query, provider: config.provider, results: results.slice(0, count) };
  },
);
