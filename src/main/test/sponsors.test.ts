import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn());
const settingsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal },
}));
vi.mock('../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../settings/prefs', () => ({
  readSetting: (key: string) => settingsStore.get(key),
  writeSetting: (key: string, value: string) => void settingsStore.set(key, value),
}));

const UNAVAILABLE = '暂时无法获取赞助名单';
const FIXTURE_BASE = {
  schemaVersion: 1,
  revision: 'r1',
  updatedAt: '2026-10-07T08:00:00Z',
};

function listBody(entries: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...FIXTURE_BASE, sponsors: entries, ...extra });
}

function json(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body);
}

let server: Server;
let origin: string;
let responder: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
let requests: { url: string; headers: IncomingHttpHeaders }[] = [];

beforeEach(async () => {
  requests = [];
  responder = undefined;
  settingsStore.clear();
  server = createServer((req, res) => {
    requests.push({ url: req.url!, headers: req.headers });
    if (!responder) {
      json(res, 503, '{}');
      return;
    }
    responder(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DELA_SUPPORT_ORIGIN = origin;
});

afterEach(async () => {
  delete process.env.DELA_SUPPORT_ORIGIN;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 重载模块：清空内存缓存与退避计时，读取本轮测试的桩服务地址。 */
async function loadSponsors(): Promise<typeof import('../sponsors')> {
  vi.resetModules();
  return import('../sponsors');
}

it('fetches the public list and caches it locally', async () => {
  responder = (_req, res) =>
    json(
      res,
      200,
      listBody([
        { id: 'public-1', name: '示例赞助者', avatarPath: '/media/avatars/example-v1.webp' },
      ]),
      { etag: 'W/"r1"' },
    );
  const api = await loadSponsors();
  expect(api.getSponsorsState().sponsors).toBeNull();
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBeNull();
  expect(state.sponsors).toEqual([
    { id: 'public-1', name: '示例赞助者', avatarUrl: `${origin}/media/avatars/example-v1.webp` },
  ]);
  expect(state.checkedAt).toBeTruthy();
  expect(settingsStore.get('sponsors-cache')).toContain('public-1');
  expect(requests[0]!.headers.accept).toBe('application/json');
});

it('treats an empty list as the latest roster, clearing previous entries', async () => {
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]));
  const api = await loadSponsors();
  await api.refreshSponsors({ force: true });
  responder = (_req, res) => json(res, 200, listBody([], { revision: 'r2' }));
  const state = await api.refreshSponsors({ force: true });
  expect(state.sponsors).toEqual([]);
  expect(state.error).toBeNull();
});

it('keeps special characters in names as plain text', async () => {
  const raw = '<img src=x onerror=alert(1)>甲"; DROP TABLE';
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: raw, avatarPath: null }]));
  const api = await loadSponsors();
  const state = await api.refreshSponsors({ force: true });
  expect(state.sponsors?.[0]?.name).toBe(raw);
});

it('ignores unknown additional fields', async () => {
  responder = (_req, res) =>
    json(
      res,
      200,
      listBody([{ id: 'a', name: '甲', avatarPath: null, tier: 'gold' }], { notice: 'beta' }),
    );
  const api = await loadSponsors();
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBeNull();
  expect(state.sponsors).toHaveLength(1);
});

it.each([
  'https://evil.example/a.png',
  '//evil.example/a.png',
  '/media/other/a.png',
  'media/avatars/a.png',
  'https://sponsor.example/media/avatars/a.png',
])('rejects the whole response for avatar path %s', async (avatarPath) => {
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath }]));
  const api = await loadSponsors();
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBe(UNAVAILABLE);
  expect(state.sponsors).toBeNull();
});

const invalidPayloadCases: [string, (payload: Record<string, unknown>) => void][] = [
  ['missing revision', (payload) => delete payload.revision],
  ['unsupported schemaVersion', (payload) => void (payload.schemaVersion = 2)],
  ['wrong sponsors type', (payload) => void (payload.sponsors = 'nope')],
  ['missing name', (payload) => void (payload.sponsors = [{ id: 'a', avatarPath: null }])],
];

it.each(invalidPayloadCases)('rejects %s and keeps the previous cache', async (_name, mutate) => {
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]));
  const api = await loadSponsors();
  await api.refreshSponsors({ force: true });
  const payload: Record<string, unknown> = {
    ...FIXTURE_BASE,
    sponsors: [{ id: 'a', name: '甲', avatarPath: null }],
  };
  mutate(payload);
  responder = (_req, res) => json(res, 200, JSON.stringify(payload));
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBe(UNAVAILABLE);
  expect(state.sponsors).toEqual([{ id: 'a', name: '甲', avatarUrl: null }]);
});

it('rejects duplicate sponsor ids', async () => {
  responder = (_req, res) =>
    json(
      res,
      200,
      listBody([
        { id: 'a', name: '甲', avatarPath: null },
        { id: 'a', name: '甲二号', avatarPath: null },
      ]),
    );
  const api = await loadSponsors();
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBe(UNAVAILABLE);
  expect(state.sponsors).toBeNull();
});

it('revalidates with the cached etag and keeps data on 304', async () => {
  responder = (_req, res) =>
    json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]), { etag: '"r1"' });
  const api = await loadSponsors();
  await api.refreshSponsors({ force: true });
  responder = (_req, res) => res.writeHead(304).end();
  const state = await api.refreshSponsors({ force: true });
  expect(requests[1]!.headers['if-none-match']).toBe('"r1"');
  expect(state.error).toBeNull();
  expect(state.sponsors).toEqual([{ id: 'a', name: '甲', avatarUrl: null }]);
});

it('holds automatic refresh after 429 retry-after while manual retry proceeds', async () => {
  responder = (_req, res) => res.writeHead(429, { 'retry-after': '120' }).end();
  const api = await loadSponsors();
  const failed = await api.refreshSponsors({ force: true });
  expect(failed.error).toBe(UNAVAILABLE);
  const held = await api.refreshSponsors({ force: false });
  expect(requests).toHaveLength(1);
  expect(held.error).toBe(UNAVAILABLE);
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]));
  const state = await api.refreshSponsors({ force: true });
  expect(requests).toHaveLength(2);
  expect(state.sponsors).toHaveLength(1);
});

it('applies cooldown between automatic refreshes after success', async () => {
  responder = (_req, res) => json(res, 200, listBody([]));
  const api = await loadSponsors();
  await api.refreshSponsors({ force: true });
  await api.refreshSponsors({ force: false });
  expect(requests).toHaveLength(1);
});

it('merges concurrent refreshes into one request', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  responder = (_req, res) =>
    void gate.then(() => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }])));
  const api = await loadSponsors();
  const first = api.refreshSponsors({ force: true });
  const second = api.refreshSponsors({ force: true });
  release();
  const [a, b] = await Promise.all([first, second]);
  expect(requests).toHaveLength(1);
  expect(a).toEqual(b);
});

it('reports refreshing while a request is in flight', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  responder = (_req, res) => void gate.then(() => json(res, 200, listBody([])));
  const api = await loadSponsors();
  const pending = api.refreshSponsors({ force: true });
  expect(api.getSponsorsState().refreshing).toBe(true);
  release();
  await pending;
  expect(api.getSponsorsState().refreshing).toBe(false);
});

it('ignores an expired cache and drops its etag', async () => {
  responder = (_req, res) =>
    json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]), { etag: '"r1"' });
  const first = await loadSponsors();
  await first.refreshSponsors({ force: true });
  const stored = JSON.parse(settingsStore.get('sponsors-cache')!) as { checkedAt: string };
  stored.checkedAt = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
  settingsStore.set('sponsors-cache', JSON.stringify(stored));
  const api = await loadSponsors();
  expect(api.getSponsorsState().sponsors).toBeNull();
  responder = (_req, res) => json(res, 200, listBody([{ id: 'b', name: '乙', avatarPath: null }]));
  const state = await api.refreshSponsors({ force: true });
  expect(requests[0]!.headers['if-none-match']).toBeUndefined();
  expect(state.sponsors?.[0]?.name).toBe('乙');
});

it('treats a corrupt persisted cache as absent', async () => {
  settingsStore.set('sponsors-cache', '{not json');
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]));
  const api = await loadSponsors();
  expect(api.getSponsorsState().sponsors).toBeNull();
  expect(api.getSponsorsState().error).toBeNull();
  const state = await api.refreshSponsors({ force: true });
  expect(state.sponsors).toHaveLength(1);
});

it('keeps the cached list when the service answers 503', async () => {
  responder = (_req, res) => json(res, 200, listBody([{ id: 'a', name: '甲', avatarPath: null }]));
  const api = await loadSponsors();
  await api.refreshSponsors({ force: true });
  responder = (_req, res) =>
    json(res, 503, JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'x' } }));
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBe(UNAVAILABLE);
  expect(state.sponsors).toEqual([{ id: 'a', name: '甲', avatarUrl: null }]);
});

it('rejects an oversized response body', async () => {
  responder = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('x'.repeat(1_000_001));
  };
  const api = await loadSponsors();
  const state = await api.refreshSponsors({ force: true });
  expect(state.error).toBe(UNAVAILABLE);
  expect(state.sponsors).toBeNull();
});

it('opens the support page in the system browser', async () => {
  const api = await loadSponsors();
  await api.openSupportPage();
  expect(openExternal).toHaveBeenCalledWith(`${origin}/support`);
});
