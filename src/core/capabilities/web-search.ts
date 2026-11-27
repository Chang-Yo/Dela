import { z } from 'zod';
import type {
  WebSearchEntry,
  WebSearchEntrySummary,
  WebSearchKeySource,
} from '../protocol/capabilities';
import { providerIdSchema } from '../protocol/agent';
import {
  isJsonObject,
  readConfigFile,
  sectionOf,
  uniqueKey,
  updateConfigFile,
  type JsonObject,
} from '../config-files';
import { loadLlmConfig } from '../agent/llm-config';
import { readDisabledTools, setBuiltinCapabilities } from './tools';
import { searchDeepSeek } from './deepseek';

// 搜索服务配置（设置 › 内置能力 › 网络）存在 ~/.dela/config.json 的 webSearch 里：可存多条
// （同类型可重复，供多账号复用额度），聊天输入框左下角选择当前使用哪一条；应用不内置搜索服务。
const SECTION_KEY = 'webSearch';
const REQUEST_TIMEOUT_MS = 15000;
// 4 类服务各留多账号余量且列表一屏可浏览；再大主要防配置堆积。
const ENTRY_LIMIT = 16;

// 请求头键限 HTTP token 字符；条数封顶防滥用。
const headerKeySchema = z.string().regex(/^[\w!#$%&'*+\-.^`|~]{1,128}$/);
const headersSchema = z
  .record(headerKeySchema, z.string().min(1).max(2048))
  .refine((headers) => Object.keys(headers).length <= 32, '自定义请求头最多 32 条');

const bodySchema = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .refine((body) => {
    try {
      JSON.parse(fillBody(body, 'q', 5));
      return true;
    } catch {
      return false;
    }
  }, '请求体需为 JSON，可用 {query}、{count} 占位');

const nameSchema = z.string().trim().min(1).max(64);
const entryId = providerIdSchema;

const webSearchEntrySchema = z.discriminatedUnion('provider', [
  z.object({
    id: entryId,
    name: nameSchema,
    provider: z.literal('brave'),
    apiKey: z.string().trim().min(1).max(256),
  }),
  z.object({
    id: entryId,
    name: nameSchema,
    provider: z.literal('google'),
    apiKey: z.string().trim().min(1).max(256),
    cx: z.string().trim().min(1).max(128),
  }),
  z.object({
    id: entryId,
    name: nameSchema,
    provider: z.literal('custom'),
    url: z.string().url().max(2048),
    body: bodySchema.optional(),
    headers: headersSchema.optional(),
  }),
  z.object({
    id: entryId,
    name: nameSchema,
    provider: z.literal('deepseek'),
    apiKey: z.string().trim().min(1).max(256),
    useForFetch: z.boolean(),
  }),
]);

export const webSearchEntryInputSchema = z.discriminatedUnion('provider', [
  z
    .object({
      id: entryId.optional(),
      name: nameSchema,
      provider: z.literal('brave'),
      apiKey: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      id: entryId.optional(),
      name: nameSchema,
      provider: z.literal('google'),
      apiKey: z.string().trim().min(1).max(256),
      cx: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      id: entryId.optional(),
      name: nameSchema,
      provider: z.literal('custom'),
      url: z.string().url().max(2048),
      body: bodySchema.optional(),
      headers: headersSchema.optional(),
    })
    .strict(),
  z
    .object({
      id: entryId.optional(),
      name: nameSchema,
      provider: z.literal('deepseek'),
      apiKey: z.string().trim().min(1).max(256),
      useForFetch: z.boolean(),
    })
    .strict(),
]);

interface Registry {
  providers: WebSearchEntry[];
  selectedId: string | null;
}

/** 文件里 services 的键是条目 id；写错的单项跳过，改哪项只写哪项。 */
function readRegistry(): Registry {
  const section = readConfigFile('config.json')[SECTION_KEY];
  if (!isJsonObject(section)) return { providers: [], selectedId: null };
  const services = isJsonObject(section.services) ? section.services : {};
  const providers = Object.entries(services).flatMap(([id, value]) => {
    const entry = webSearchEntrySchema.safeParse(isJsonObject(value) ? { ...value, id } : null);
    return entry.success ? [entry.data] : [];
  });
  const selected = providers.find(({ id }) => id === section.selected);
  return { providers, selectedId: selected?.id ?? null };
}

function updateWebSearch(update: (section: JsonObject, services: JsonObject) => void): void {
  updateConfigFile('config.json', (config) => {
    const section = sectionOf(config, SECTION_KEY);
    update(section, sectionOf(section, 'services'));
  });
}

export function listWebSearchEntries(): WebSearchEntry[] {
  return readRegistry().providers;
}

export function readWebSearchConfig(): WebSearchEntry | null {
  const { providers, selectedId } = readRegistry();
  return providers.find(({ id }) => id === selectedId) ?? null;
}

/** 新建或更新一条配置；新建的 id 是服务类型（brave、deepseek…），新建即选中并启用 web_search，更新不改选中。返回最新列表。 */
export function saveWebSearchEntry(
  input: z.infer<typeof webSearchEntryInputSchema>,
): WebSearchEntry[] {
  const registry = readRegistry();
  const exists = input.id != null && registry.providers.some(({ id }) => id === input.id);
  // 幽灵 id（别处已删除的草稿）按新建追加会静默复活条目，明确报错让用户重建。
  if (input.id != null && !exists) throw new Error('搜索服务配置不存在，可能已被删除');
  if (!exists && registry.providers.length >= ENTRY_LIMIT)
    throw new Error(`搜索服务配置最多 ${ENTRY_LIMIT} 条，请先删除部分配置`);
  const { id, ...entry } = input;
  updateWebSearch((section, services) => {
    if (id) services[id] = entry;
    else {
      const created = uniqueKey(services, entry.provider);
      services[created] = entry;
      section.selected = created;
    }
  });
  if (!exists) setBuiltinCapabilities(['web_search'], true);
  return readRegistry().providers;
}

export function removeWebSearchEntry(id: string): WebSearchEntry[] {
  const registry = readRegistry();
  const providers = registry.providers.filter((item) => item.id !== id);
  const selectedId = registry.selectedId === id ? (providers[0]?.id ?? null) : registry.selectedId;
  updateWebSearch((section, services) => {
    delete services[id];
    section.selected = selectedId;
  });
  if (selectedId === null) setBuiltinCapabilities(['web_search'], false);
  return providers;
}

export function listWebSearchOptions(): {
  entries: WebSearchEntrySummary[];
  selectedId: string | null;
} {
  const { providers, selectedId } = readRegistry();
  return {
    entries: providers.map(({ id, name, provider }) => ({ id, name, provider })),
    selectedId:
      !readDisabledTools().has('web_search') && providers.some(({ id }) => id === selectedId)
        ? selectedId
        : null,
  };
}

/** 选择当前使用哪条配置并确保 web_search 开启；null 关闭联网搜索（web_fetch 仍走本地抓取）。 */
export function selectWebSearchEntry(id: string | null): void {
  if (id !== null && !readRegistry().providers.some((item) => item.id === id))
    throw new Error('搜索服务配置不存在，可能已被删除');
  updateWebSearch((section) => {
    section.selected = id;
  });
  setBuiltinCapabilities(['web_search'], id !== null);
}

/** DeepSeek 官方端点判定：只认 api.deepseek.com，中转或自建网关一律不算。 */
function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return /(^|\.)api\.deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function listWebSearchKeySources(): WebSearchKeySource[] {
  return loadLlmConfig()
    .providers.filter((provider) => provider.apiKey && isDeepSeekEndpoint(provider.baseUrl))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    .map(({ id, name }) => ({ id, name }));
}

/** 读出指定 DeepSeek 模型供应商的密钥给表单预填（静态副本，不落库、不随供应商换 Key 更新）；不可用时返回 null。 */
export function readWebSearchKey(providerId: string): string | null {
  const provider = loadLlmConfig().providers.find(({ id }) => id === providerId);
  return provider?.apiKey && isDeepSeekEndpoint(provider.baseUrl) ? provider.apiKey : null;
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

// Brave 固定走 LLM Context 端点：grounding.generic 与 map/poi 同构，snippets 是页面抽取的片段而非搜索摘要。
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

function fillBody(body: string, query: string, count: number): string {
  return body
    .replaceAll('{query}', JSON.stringify(query).slice(1, -1))
    .replaceAll('{count}', String(count));
}

const RESULT_PATHS = [
  'results',
  'organic_results',
  'organic',
  'items',
  'data',
  'web.results',
  'webPages.value',
  'data.webPages.value',
  'data.results',
  'data.items',
];
const URL_FIELDS = ['url', 'link', 'href'];
const TITLE_FIELDS = ['title', 'name'];
const SNIPPET_FIELDS = ['content', 'snippet', 'description', 'summary', 'text'];

function pickText(item: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string') return value;
  }
}

function readResults(payload: unknown): WebSearchResult[] {
  const list = RESULT_PATHS.map((path) =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
        payload,
      ),
  ).find(Array.isArray);
  if (!list) {
    const keys = payload && typeof payload === 'object' ? Object.keys(payload).join('、') : '';
    throw new Error(
      `无法识别搜索结果：返回的顶层字段为「${keys || '空'}」，需包含 results 等结果数组`,
    );
  }
  return list.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const url = pickText(record, URL_FIELDS);
    if (!url) return [];
    return [
      {
        url,
        title: compact(pickText(record, TITLE_FIELDS)) || url,
        snippet: compact(pickText(record, SNIPPET_FIELDS)),
      },
    ];
  });
}

// 自定义端点：填了请求体走 POST，否则 GET；URL 与请求体中的 {query}、{count} 替换为实参。
// GET 且 URL 不含 {query} 时按 SearXNG 追加 q 与 format=json。自定义请求头可覆盖默认头。
async function searchCustomEndpoint(
  query: string,
  count: number,
  endpoint: string,
  body: string | undefined,
  headers: Record<string, string> | undefined,
): Promise<WebSearchResult[]> {
  const url =
    body || endpoint.includes('{query}')
      ? endpoint
          .replaceAll('{query}', encodeURIComponent(query))
          .replaceAll('{count}', String(count))
      : `${endpoint}${endpoint.includes('?') ? '&' : '?'}${new URLSearchParams({ q: query, format: 'json' })}`;
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? fillBody(body, query, count) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    // SearXNG 把无响应引擎序列化为 [引擎名, 错误文案] 元组的数组。
    unresponsive_engines?: (string | [string, string])[];
  };
  const results = readResults(payload);
  if (results.length === 0 && (payload.unresponsive_engines?.length ?? 0) > 0) {
    const engines = payload
      .unresponsive_engines!.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter(Boolean);
    throw new Error(`搜索服务全部引擎无响应（${engines.join('、')}），请检查实例配置`);
  }
  return results;
}

export async function webSearch(query: string, count = 5, freshness?: string) {
  const config = readWebSearchConfig();
  if (!config)
    throw new Error(
      '尚未选择搜索服务：请在聊天输入框左下角选择，或在 设置 › 内置能力 的「网络」分组中配置',
    );
  const results =
    config.provider === 'brave'
      ? await searchBrave(query, count, freshness, config.apiKey)
      : config.provider === 'google'
        ? await searchGoogle(query, count, config.apiKey, config.cx)
        : config.provider === 'deepseek'
          ? await searchDeepSeek(query, count, config.apiKey)
          : await searchCustomEndpoint(query, count, config.url, config.body, config.headers);
  return { query, provider: config.provider, results: results.slice(0, count) };
}
