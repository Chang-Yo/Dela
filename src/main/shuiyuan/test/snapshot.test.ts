import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let userData = '';
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 4000, height: 3000 }),
      resize: () => ({ toJPEG: () => Buffer.from('thumbnail') }),
    })),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`)),
    decryptString: vi.fn((value: Buffer) => {
      if (!value.toString().startsWith('sealed:')) throw new Error('wrong machine');
      return value.toString().slice(7);
    }),
  },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../credentials', () => ({
  loadShuiyuanCredential: () => ({ key: 'user-key', clientId: 'client' }),
}));
vi.mock('../../notifications/system', () => ({
  isWorkspaceWindow: () => true,
  systemNotifyToast: vi.fn(),
}));
vi.mock('../../settings/prefs', () => ({ experimentEnabled: () => true }));
vi.mock('../api', () => ({
  SHUIYUAN_ORIGIN: 'https://shuiyuan.sjtu.edu.cn',
  getShuiyuanTopic: vi.fn(),
  loadShuiyuanPosts: vi.fn(),
}));
vi.mock('../budget', () => ({
  waitForShuiyuanBackgroundSlot: async () => {},
  noteShuiyuanResponse: () => {},
}));

import { getDatabase } from '../../database';
import { nativeImage, safeStorage } from 'electron';
import { systemNotifyToast } from '../../notifications/system';
import { getShuiyuanTopic, loadShuiyuanPosts } from '../api';
import { collectShuiyuanSnapshots, queueShuiyuanSnapshot } from '../snapshot';
import {
  encryptSnapshotBytes,
  decryptSnapshotBytes,
  writeSnapshotBytes,
  readShuiyuanSnapshot,
  findShuiyuanSnapshot,
  readShuiyuanSnapshotPage,
  handleShuiyuanSnapshotRequest,
} from '../snapshot-files';

const site = 'https://shuiyuan.sjtu.edu.cn';
const original = `${site}/secure-uploads/original/4X/a/b/c/abc.jpeg`;
const lightbox =
  `<div class="lightbox-wrapper"><a class="lightbox" href="${original}" data-download-href="/x">` +
  `<img src="${site}/secure-uploads/optimized/abc_2_690x432.jpeg" srcset="/a 1.5x"></a></div>`;

let db: Database.Database;
let fetch: ReturnType<typeof vi.fn>;

function post(id: number, cooked = `<p>楼 ${id}</p>`) {
  return {
    id,
    postNumber: id,
    username: `u${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    replyToPostNumber: null,
    cooked,
  };
}

function mockTopic(posts: ReturnType<typeof post>[], loaded = 20) {
  vi.mocked(getShuiyuanTopic).mockResolvedValue({
    title: '长帖',
    stream: posts.map((item) => item.id),
    posts: posts.slice(0, loaded),
  } as never);
  vi.mocked(loadShuiyuanPosts).mockImplementation(
    async (_topicId, ids) => posts.filter((item) => (ids as number[]).includes(item.id)) as never,
  );
}

function image(type = 'image/jpeg') {
  return new Response('bytes', { headers: { 'content-type': type } });
}

// Windows CI 的慢 runner 上，整条快照流程会超过 waitFor 默认的 1 秒
const WAIT = { timeout: 5000 };

async function saved(topicId = 42): Promise<string> {
  await vi.waitFor(() => {
    const row = db
      .prepare('SELECT snapshot_status FROM shuiyuan_topics WHERE topic_id = ?')
      .get(topicId) as { snapshot_status: string };
    expect(row.snapshot_status).not.toBe('saving');
  }, WAIT);
  return (
    db.prepare('SELECT snapshot_status FROM shuiyuan_topics WHERE topic_id = ?').get(topicId) as {
      snapshot_status: string;
    }
  ).snapshot_status;
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'dela-snapshot-'));
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT);
    CREATE TABLE shuiyuan_topics (topic_id INTEGER PRIMARY KEY, title TEXT NOT NULL,
      snapshot_status TEXT, snapshot_at TEXT, snapshot_error TEXT);
    INSERT INTO shuiyuan_topics (topic_id, title) VALUES (42, '长帖');
    INSERT INTO workspace_entries VALUES ('e1', 'source', 'shuiyuan-topic:42');
  `);
  vi.mocked(getDatabase).mockReturnValue(db);
  fetch = vi.fn(async () => image());
  vi.stubGlobal('fetch', fetch);
});

it('deduplicates thumbnail generation and keeps original bytes for the lightbox', async () => {
  const dir = join(userData, 'shuiyuan-snapshots', '42', 'images');
  mkdirSync(dir, { recursive: true });
  const file = '0123456789abcdef0123456789abcdef.jpg';
  await writeSnapshotBytes(join(dir, file), 'original');
  const url = new URL(`dela-resource://shuiyuan-snapshot/42/${file}?thumbnail=1`);
  const results = await Promise.all([
    handleShuiyuanSnapshotRequest(url),
    handleShuiyuanSnapshotRequest(url),
  ]);
  expect(await results[0]!.text()).toBe('thumbnail');
  expect(await results[1]!.text()).toBe('thumbnail');
  expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
  await handleShuiyuanSnapshotRequest(url);
  expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
  expect(results[0]!.headers.get('cache-control')).toBe('no-store');
  expect(readFileSync(join(dir, file)).includes(Buffer.from('original'))).toBe(false);
  const thumbnail = readFileSync(join(dir, '..', 'thumbnails', file));
  expect(thumbnail.includes(Buffer.from('thumbnail'))).toBe(false);
  expect(decryptSnapshotBytes(thumbnail).toString()).toBe('thumbnail');
  url.search = '';
  expect(await (await handleShuiyuanSnapshotRequest(url)).text()).toBe('original');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  rmSync(userData, { recursive: true, force: true });
});

it('saves every post, loading the rest of the stream 100 ids at a time', async () => {
  mockTopic(Array.from({ length: 250 }, (_, index) => post(index + 1)));

  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('done');
  expect(
    vi.mocked(loadShuiyuanPosts).mock.calls.map(([, ids]) => (ids as number[]).length),
  ).toEqual([100, 100, 30]);
  const snapshot = (await readShuiyuanSnapshot(42))!;
  expect(snapshot.posts.map((item) => item.postNumber)).toEqual(
    Array.from({ length: 250 }, (_, index) => index + 1),
  );
  const row = db.prepare('SELECT snapshot_at FROM shuiyuan_topics').get() as {
    snapshot_at: string;
  };
  expect(row.snapshot_at).toBe(snapshot.savedAt);
  expect(existsSync(join(userData, 'shuiyuan-snapshots', '42.partial'))).toBe(false);
});

it('stores originals locally, drops avatars and keeps failed external images online', async () => {
  const emoji = `${site}/images/emoji/twitter/smile.png?v=12`;
  const external = 'https://example.com/a.png';
  mockTopic([
    post(
      1,
      `${lightbox}<img class="avatar" src="/user_avatar/shuiyuan.sjtu.edu.cn/u/48/1.png">` +
        `<img class="emoji" src="${emoji}"><img src="${external}">`,
    ),
    post(2, lightbox),
  ]);
  fetch.mockImplementation(async (url: URL) =>
    url.href === external ? new Response('nope', { status: 404 }) : image(),
  );

  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('done');
  const calls = fetch.mock.calls.map(([url, init]) => [
    (url as URL).href,
    Boolean((init as RequestInit).headers && 'User-Api-Key' in (init as RequestInit).headers!),
  ]);
  expect(calls).toEqual([
    [original, true],
    [emoji, false],
    [external, false],
  ]);
  const [first, second] = (await readShuiyuanSnapshot(42))!.posts;
  expect(first!.cooked).not.toContain('avatar');
  expect(first!.cooked).not.toContain('srcset');
  expect(first!.cooked).not.toContain(`href="${original}"`);
  expect(first!.cooked).toMatch(/src="dela-resource:\/\/shuiyuan-snapshot\/42\/[0-9a-f]{32}\.jpg"/);
  expect(first!.cooked).toContain(`src="${external}"`);
  expect(second!.cooked).toMatch(/dela-resource:\/\/shuiyuan-snapshot\/42\//);
  expect(readdirSync(join(userData, 'shuiyuan-snapshots', '42', 'images'))).toHaveLength(2);
});

it('writes a readable draft with pending images before the images are saved', async () => {
  mockTopic([post(1, lightbox), post(2)]);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  fetch.mockImplementation(async () => {
    await blocked;
    return image();
  });

  queueShuiyuanSnapshot(42);

  const draft = await vi.waitFor(async () => {
    const value = await readShuiyuanSnapshot(42);
    expect(value).not.toBeNull();
    return value!;
  }, WAIT);
  expect(draft.posts).toHaveLength(2);
  const partial = join(userData, 'shuiyuan-snapshots', '42.partial');
  expect(readFileSync(join(partial, 'page-0.json')).includes(Buffer.from(original))).toBe(false);
  const records = readFileSync(join(partial, 'posts.ndjson'), 'utf8').trim().split('\n');
  expect(records.join('').includes('cooked')).toBe(false);
  expect(
    JSON.parse(decryptSnapshotBytes(Buffer.from(records[0]!, 'base64')).toString()).cooked,
  ).toContain(original);
  expect(draft.posts[0]!.cooked).toContain('data-snapshot-pending');
  expect(await readShuiyuanSnapshot(42)).toMatchObject({ draft: true });

  release();
  expect(await saved()).toBe('done');
  expect((await readShuiyuanSnapshot(42))!.posts[0]!.cooked).not.toContain('data-snapshot-pending');
});

it('fails when the site is unreachable and resumes without refetching saved images', async () => {
  const second = `${site}/secure-uploads/original/4X/d/e/f/def.png`;
  mockTopic([post(1, lightbox), post(2, `<img src="${second}">`)]);
  fetch.mockImplementation(async (url: URL) => {
    if (url.href === second) throw new TypeError('fetch failed');
    return image();
  });

  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('failed');
  expect(systemNotifyToast).toHaveBeenCalledOnce();
  expect(await readShuiyuanSnapshot(42)).toMatchObject({ draft: true });

  fetch.mockClear();
  fetch.mockImplementation(async () => image('image/png'));
  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('done');
  expect(fetch.mock.calls.map(([url]) => (url as URL).href)).toEqual([second]);
});

it('resumes an interrupted save without refetching the posts it already has', async () => {
  const posts = Array.from({ length: 250 }, (_, index) => post(index + 1));
  mockTopic(posts);
  vi.mocked(loadShuiyuanPosts).mockImplementation(async (_topicId, ids) => {
    if ((ids as number[]).includes(250)) throw new Error('无法连接水源社区，请检查网络后重试');
    return posts.filter((item) => (ids as number[]).includes(item.id)) as never;
  });

  queueShuiyuanSnapshot(42);
  expect(await saved()).toBe('failed');

  mockTopic(posts);
  vi.mocked(loadShuiyuanPosts).mockClear();
  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('done');
  expect(
    vi.mocked(loadShuiyuanPosts).mock.calls.map(([, ids]) => (ids as number[]).length),
  ).toEqual([30]);
  expect((await readShuiyuanSnapshot(42))!.posts).toHaveLength(250);
  expect(readdirSync(join(userData, 'shuiyuan-snapshots', '42'))).not.toContain('posts.ndjson');
});

it('refreshing reuses images from the previous snapshot', async () => {
  mockTopic([post(1, lightbox)]);
  queueShuiyuanSnapshot(42);
  expect(await saved()).toBe('done');
  const before = (await readShuiyuanSnapshot(42))!;

  mockTopic([post(1, lightbox), post(2)]);
  fetch.mockClear();
  queueShuiyuanSnapshot(42);

  expect(await saved()).toBe('done');
  expect(fetch).not.toHaveBeenCalled();
  const after = (await readShuiyuanSnapshot(42))!;
  expect(after.posts).toHaveLength(2);
  expect(after.posts[0]!.cooked).toBe(before.posts[0]!.cooked);
});

it('makes saved images visible in paged drafts and keeps full reads available for the agent', async () => {
  mockTopic(
    Array.from({ length: 25 }, (_, index) =>
      post(index + 1, index === 20 ? lightbox : '<p>正文</p>'),
    ),
  );
  let release!: () => void;
  fetch.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return image();
  });
  queueShuiyuanSnapshot(42);
  await vi.waitFor(async () => {
    expect((await findShuiyuanSnapshot(42))?.index).toMatchObject({ postCount: 25 });
    expect(release).toBeDefined();
  }, WAIT);
  expect((await readShuiyuanSnapshotPage(42, 2))[0]!.cooked).toContain('data-snapshot-pending');
  release();
  expect(await saved()).toBe('done');
  const page = await readShuiyuanSnapshotPage(42, 2);
  expect(page).toHaveLength(5);
  expect(page[0]!.cooked).toContain('dela-resource://shuiyuan-snapshot/42/');
  expect(page[0]!.cooked).not.toContain('data-snapshot-pending');
  expect((await readShuiyuanSnapshot(42))!.posts).toHaveLength(25);
});

it('reads only the requested page without downloading', async () => {
  const dir = join(userData, 'shuiyuan-snapshots', '42');
  mkdirSync(dir, { recursive: true });
  const index = { title: '快照', savedAt: '2026-11-04T00:00:00Z', postCount: 25, pageSize: 10 };
  await writeSnapshotBytes(join(dir, 'index.json'), JSON.stringify(index));
  await writeSnapshotBytes(
    join(dir, 'page-2.json'),
    JSON.stringify(Array.from({ length: 5 }, (_, i) => post(i + 21))),
  );
  expect((await findShuiyuanSnapshot(42))?.index).toEqual(index);
  expect((await readShuiyuanSnapshotPage(42, 2)).map((p) => p.postNumber)).toEqual([
    21, 22, 23, 24, 25,
  ]);
  expect(await readShuiyuanSnapshotPage(42, 3)).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('prefers the completed snapshot over a newer draft for all local readers', async () => {
  const root = join(userData, 'shuiyuan-snapshots');
  for (const [name, title] of [
    ['42', '已保存'],
    ['42.partial', '草稿'],
  ]) {
    const dir = join(root, name!);
    mkdirSync(dir, { recursive: true });
    await writeSnapshotBytes(
      join(dir, 'index.json'),
      JSON.stringify({ title, savedAt: '2026-11-04', postCount: 1, pageSize: 10 }),
    );
    await writeSnapshotBytes(join(dir, 'page-0.json'), JSON.stringify([post(1, title)]));
  }
  expect(await readShuiyuanSnapshot(42)).toMatchObject({ title: '已保存', draft: false });
  expect((await findShuiyuanSnapshot(42))?.index.title).toBe('已保存');
  expect((await readShuiyuanSnapshotPage(42, 0))[0]?.cooked).toBe('已保存');
  rmSync(join(root, '42'), { recursive: true });
  expect(await readShuiyuanSnapshot(42)).toMatchObject({ title: '草稿', draft: true });
  expect((await readShuiyuanSnapshotPage(42, 0))[0]?.cooked).toBe('草稿');
});

it('preserves previously saved images when the same page is flushed again', async () => {
  const second = `${site}/uploads/second.png`;
  mockTopic([post(1, `${lightbox}<img src="${second}">`)]);
  const now = vi.spyOn(Date, 'now');
  fetch.mockImplementation(async () => {
    now.mockReturnValue(new Date().getTime() + 6_000);
    return image();
  });
  try {
    queueShuiyuanSnapshot(42);
    expect(await saved()).toBe('done');
    const html = (await readShuiyuanSnapshotPage(42, 0))[0]!.cooked;
    expect(html.match(/src="dela-resource:\/\/shuiyuan-snapshot\//g)).toHaveLength(2);
    expect(html).not.toContain('data-snapshot-pending');
  } finally {
    now.mockRestore();
  }
});

it('collects snapshots of topics no longer in any project', async () => {
  mockTopic([post(1, lightbox)]);
  queueShuiyuanSnapshot(42);
  expect(await saved()).toBe('done');

  db.exec('DELETE FROM workspace_entries');
  await collectShuiyuanSnapshots();

  expect(existsSync(join(userData, 'shuiyuan-snapshots', '42'))).toBe(false);
  expect(db.prepare('SELECT snapshot_status, snapshot_at FROM shuiyuan_topics').get()).toEqual({
    snapshot_status: null,
    snapshot_at: null,
  });
});

it('uses random nonces and rejects tampered ciphertext', () => {
  const first = encryptSnapshotBytes('正文');
  const second = encryptSnapshotBytes('正文');
  expect(first.equals(second)).toBe(false);
  expect(decryptSnapshotBytes(first).toString()).toBe('正文');
  first[first.length - 1] = first[first.length - 1]! ^ 1;
  expect(() => decryptSnapshotBytes(first)).toThrow('无法解密');
});

it('keeps the key through collection and reads it again after restarting', async () => {
  mockTopic([post(1)]);
  queueShuiyuanSnapshot(42);
  expect(await saved()).toBe('done');
  const key = readFileSync(join(userData, 'shuiyuan-snapshots', 'key.bin'));
  await collectShuiyuanSnapshots();
  vi.resetModules();
  const reopened = await import('../snapshot-files');
  expect((await reopened.readShuiyuanSnapshot(42))?.posts).toHaveLength(1);
  expect(readFileSync(join(userData, 'shuiyuan-snapshots', 'key.bin'))).toEqual(key);
});

it.each(['missing', 'unreadable'])(
  'rebuilds snapshots after a %s key without reusing old images',
  async (failure) => {
    mockTopic([post(1, lightbox)]);
    queueShuiyuanSnapshot(42);
    expect(await saved()).toBe('done');
    const root = join(userData, 'shuiyuan-snapshots');
    const keyPath = join(root, 'key.bin');
    const key = readFileSync(keyPath);
    cpSync(join(root, '42'), join(root, '42.partial'), { recursive: true });
    writeFileSync(
      join(root, '42.partial', 'posts.ndjson'),
      `${encryptSnapshotBytes(JSON.stringify(post(1, lightbox))).toString('base64')}\n`,
    );
    if (failure === 'missing') rmSync(keyPath);
    else writeFileSync(keyPath, 'unreadable');
    vi.resetModules();
    const files = await import('../snapshot-files');
    expect(await files.readShuiyuanSnapshot(42)).toBeNull();
    expect(readFileSync(keyPath)).not.toEqual(key);
    fetch.mockClear();
    const tasks = await import('../snapshot');
    tasks.ensureShuiyuanSnapshot(42);
    expect(await saved()).toBe('done');
    expect(fetch).toHaveBeenCalledOnce();
    expect((await files.readShuiyuanSnapshot(42))?.posts).toHaveLength(1);
  },
);

it('does not write plaintext when secure storage is unavailable', () => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
  expect(() => encryptSnapshotBytes('正文')).toThrow('安全存储不可用');
  expect(existsSync(join(userData, 'shuiyuan-snapshots', 'key.bin'))).toBe(false);
});
