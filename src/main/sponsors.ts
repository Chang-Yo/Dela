import { app, ipcMain, shell } from 'electron';
import { z } from 'zod';
import type { SponsorsState } from '../shared/sponsors';
import { checkWorkspaceSender } from './ipc';
import { readSetting, writeSetting } from './settings/prefs';

// SUPPORT_ORIGIN：所有者确定的赞助服务 origin（sponsorship-plan §6.1，显式配置、非敏感）。
// 正式地址在 M4 上线前由所有者确定并替换；当前占位使用 RFC 2606 保留域（不可解析），
// 服务未部署时关于页呈现可重试的失败态。联调可用 DELA_SUPPORT_ORIGIN 环境变量指向
// 本地桩服务，仅开发（未打包）运行生效；不自动加载仓库 .env。
const PRODUCTION_SUPPORT_ORIGIN = 'https://support.dela.example';
const SUPPORT_ORIGIN =
  !app.isPackaged && process.env.DELA_SUPPORT_ORIGIN
    ? process.env.DELA_SUPPORT_ORIGIN
    : PRODUCTION_SUPPORT_ORIGIN;
const SPONSORS_PATH = '/api/v1/sponsors';
const SUPPORT_PAGE_PATH = '/support';
const CACHE_KEY = 'sponsors-cache';

// 数值边界为 Dela 侧暂定值；M0 契约冻结后与 ECS 侧对齐（sponsorship-plan §6.3）。
const REQUEST_TIMEOUT_MS = 15_000;
const AUTO_REFRESH_COOLDOWN_MS = 60_000;
const RETRY_AFTER_MAX_MS = 10 * 60_000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_RESPONSE_CHARS = 1_000_000;

const UNAVAILABLE_MESSAGE = '暂时无法获取赞助名单';

// 客户端防御性字段上限（宽松于服务端输入限制，冻结契约后一并复核）。
const sponsorEntrySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  avatarPath: z.string().min(1).max(512).nullable(),
});
// 未知附加字段允许忽略（§6.2），只校验已定义字段。
const sponsorsResponseSchema = z.looseObject({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(128),
  updatedAt: z.string().datetime(),
  sponsors: z.array(sponsorEntrySchema),
});
const cacheSchema = z.object({
  etag: z.string().min(1).max(512).nullable(),
  revision: z.string().min(1).max(128),
  checkedAt: z.string().datetime(),
  sponsors: z.array(sponsorEntrySchema),
});
type SponsorsCache = z.infer<typeof cacheSchema>;
type ParsedSponsorsResponse = z.infer<typeof sponsorsResponseSchema>;

/** 头像相对路径解析为批准 origin 下的绝对地址；越界路径抛错使整份响应无效。 */
function avatarUrlOf(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('非法头像路径');
  const parsed = new URL(path, SUPPORT_ORIGIN);
  if (
    parsed.origin !== SUPPORT_ORIGIN ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith('/media/avatars/')
  ) {
    throw new Error('非法头像路径');
  }
  return parsed.href;
}

/** 校验名单响应：字段缺失、类型错误、重复 ID、非法头像路径或不支持的版本均无效。 */
function parseSponsorsResponse(payload: unknown): ParsedSponsorsResponse {
  const data = sponsorsResponseSchema.parse(payload);
  if (new Set(data.sponsors.map((entry) => entry.id)).size !== data.sponsors.length)
    throw new Error('重复的赞助者 ID');
  for (const entry of data.sponsors) if (entry.avatarPath !== null) avatarUrlOf(entry.avatarPath);
  return data;
}

let loadedCache: SponsorsCache | null | undefined;

function persistedCache(): SponsorsCache | null {
  if (loadedCache === undefined) {
    const raw = readSetting(CACHE_KEY);
    try {
      loadedCache = raw ? cacheSchema.parse(JSON.parse(raw)) : null;
    } catch {
      // 损坏缓存按无缓存处理，不阻塞联网刷新。
      loadedCache = null;
    }
  }
  return loadedCache;
}

/** 超过最大保留期的缓存按无数据对待（不使用其中 ETag，也不再展示）。 */
function currentCache(): SponsorsCache | null {
  const cached = persistedCache();
  if (!cached) return null;
  return Date.now() - Date.parse(cached.checkedAt) <= CACHE_MAX_AGE_MS ? cached : null;
}

function applyCache(next: SponsorsCache): void {
  loadedCache = next;
  writeSetting(CACHE_KEY, JSON.stringify(next));
}

let inFlight: Promise<SponsorsState> | null = null;
let lastNetworkAttemptAt = 0;
let autoHoldUntil = 0;
let lastError: string | null = null;

export function getSponsorsState(): SponsorsState {
  const cached = currentCache();
  return {
    sponsors: cached
      ? cached.sponsors.map((entry) => ({
          id: entry.id,
          name: entry.name,
          avatarUrl: entry.avatarPath === null ? null : avatarUrlOf(entry.avatarPath),
        }))
      : null,
    checkedAt: cached?.checkedAt ?? null,
    refreshing: inFlight !== null,
    error: lastError,
  };
}

/** 429 的 Retry-After 折算为自动刷新的暂停时长（秒数形式，封顶防长期锁死）。 */
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
}

async function runRefresh(): Promise<SponsorsState> {
  const cached = currentCache();
  const headers: Record<string, string> = { accept: 'application/json' };
  // 无对应缓存（含已过期）不使用孤立 ETag。
  if (cached?.etag) headers['if-none-match'] = cached.etag;
  try {
    const response = await fetch(new URL(SPONSORS_PATH, SUPPORT_ORIGIN).href, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > MAX_RESPONSE_CHARS) throw new Error('名单响应超出大小上限');
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new Error('名单响应超出大小上限');
    if (response.status === 304 && cached) {
      applyCache({ ...cached, checkedAt: new Date().toISOString() });
      lastError = null;
      autoHoldUntil = 0;
      return getSponsorsState();
    }
    if (!response.ok) {
      if (response.status === 429) autoHoldUntil = Date.now() + retryAfterMs(response);
      throw new Error(`HTTP ${response.status}`);
    }
    const data = parseSponsorsResponse(JSON.parse(body));
    applyCache({
      etag: response.headers.get('etag'),
      revision: data.revision,
      checkedAt: new Date().toISOString(),
      sponsors: data.sponsors,
    });
    lastError = null;
    autoHoldUntil = 0;
  } catch (error) {
    lastError = UNAVAILABLE_MESSAGE;
    console.error('Sponsors refresh failed', error instanceof Error ? error.message : error);
  }
  return getSponsorsState();
}

export function refreshSponsors(options: { force: boolean }): Promise<SponsorsState> {
  // 并发刷新合并为同一请求；自动刷新受冷却与 429 Retry-After 退避约束。
  if (inFlight) return inFlight;
  if (
    !options.force &&
    Date.now() < Math.max(lastNetworkAttemptAt + AUTO_REFRESH_COOLDOWN_MS, autoHoldUntil)
  ) {
    return Promise.resolve(getSponsorsState());
  }
  lastNetworkAttemptAt = Date.now();
  inFlight = runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** 系统浏览器打开赞助网页入口；地址固定为配置 origin 的 /support。 */
export async function openSupportPage(): Promise<void> {
  const url = new URL(SUPPORT_PAGE_PATH, SUPPORT_ORIGIN);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('不支持的赞助页地址');
  }
  await shell.openExternal(url.href);
}

export function registerSponsorsIpc(): void {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`sponsors:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('get-state', getSponsorsState);
  handle('refresh', () => refreshSponsors({ force: false }));
  handle('refresh-now', () => refreshSponsors({ force: true }));
  handle('open-support-page', openSupportPage);
}
