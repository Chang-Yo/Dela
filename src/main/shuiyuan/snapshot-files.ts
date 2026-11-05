import { app, nativeImage, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SnapshotIndex {
  title: string;
  savedAt: string;
  postCount: number;
  pageSize: number;
}

export const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};
const imageTypes = new Map(Object.entries(imageExtensions).map(([type, ext]) => [ext, type]));

export interface ShuiyuanSnapshotPost {
  postNumber: number;
  username: string;
  createdAt: string;
  replyToPostNumber: number | null;
  /** 图片已改写为本地快照地址；下载失败的图片保留原地址；草稿里还没下载的图片带 data-snapshot-pending。 */
  cooked: string;
}

export const snapshotRoot = () => join(app.getPath('userData'), 'shuiyuan-snapshots');
export const snapshotDir = (topicId: number) => join(snapshotRoot(), String(topicId));
export const partialDir = (topicId: number) => join(snapshotRoot(), `${topicId}.partial`);

const ENCRYPTED_HEADER = Buffer.from('DELA-SNAPSHOT-1');
let cachedKey: { root: string; key: Buffer } | undefined;

function snapshotKey(): Buffer {
  const root = snapshotRoot();
  if (cachedKey?.root === root) return cachedKey.key;
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('系统安全存储不可用，无法加密水源快照');
  const path = join(root, 'key.bin');
  let key: Buffer | undefined;
  if (existsSync(path)) {
    const sealed = readFileSync(path);
    try {
      const decoded = Buffer.from(safeStorage.decryptString(sealed), 'base64');
      if (decoded.length === 32) key = decoded;
    } catch {
      // 换机或密钥丢失后生成新密钥，旧快照由保存任务重新下载。
    }
  }
  if (!key) {
    key = randomBytes(32);
    const sealed = safeStorage.encryptString(key.toString('base64'));
    mkdirSync(root, { recursive: true });
    writeFileSync(`${path}.tmp`, sealed);
    renameSync(`${path}.tmp`, path);
  }
  cachedKey = { root, key };
  return key;
}

export function encryptSnapshotBytes(plaintext: Uint8Array | string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', snapshotKey(), nonce);
  cipher.setAAD(ENCRYPTED_HEADER);
  const bytes = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ENCRYPTED_HEADER, nonce, cipher.getAuthTag(), bytes]);
}

export function decryptSnapshotBytes(encrypted: Buffer): Buffer {
  const offset = ENCRYPTED_HEADER.length;
  if (encrypted.length < offset + 28 || !encrypted.subarray(0, offset).equals(ENCRYPTED_HEADER))
    throw new Error('水源快照无法解密，请重新保存快照');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      snapshotKey(),
      encrypted.subarray(offset, offset + 12),
    );
    decipher.setAAD(ENCRYPTED_HEADER);
    decipher.setAuthTag(encrypted.subarray(offset + 12, offset + 28));
    return Buffer.concat([decipher.update(encrypted.subarray(offset + 28)), decipher.final()]);
  } catch (cause) {
    throw new Error('水源快照无法解密，请重新保存快照', { cause });
  }
}

export async function readSnapshotBytes(path: string): Promise<Buffer> {
  return decryptSnapshotBytes(await readFile(path));
}

export async function writeSnapshotBytes(
  path: string,
  plaintext: Uint8Array | string,
): Promise<void> {
  await writeFile(`${path}.tmp`, encryptSnapshotBytes(plaintext));
  await rename(`${path}.tmp`, path);
}

export function hasReadableSnapshot(topicId: number): boolean {
  try {
    decryptSnapshotBytes(readFileSync(join(snapshotDir(topicId), 'index.json')));
    return true;
  } catch {
    return false;
  }
}

async function readSnapshotIndex(dir: string): Promise<SnapshotIndex | null> {
  try {
    return JSON.parse((await readSnapshotBytes(join(dir, 'index.json'))).toString('utf8'));
  } catch {
    return null;
  }
}

export async function findShuiyuanSnapshot(topicId: number) {
  for (const draft of [false, true]) {
    const dir = draft ? partialDir(topicId) : snapshotDir(topicId);
    const index = await readSnapshotIndex(dir);
    if (index) return { dir, index, draft };
  }
  return null;
}

export async function readShuiyuanSnapshot(topicId: number) {
  const selected = await findShuiyuanSnapshot(topicId);
  if (!selected) return null;
  const { dir, index, draft } = selected;
  const posts: ShuiyuanSnapshotPost[] = [];
  for (let page = 0; page < Math.ceil(index.postCount / index.pageSize); page++)
    posts.push(
      ...JSON.parse((await readSnapshotBytes(join(dir, `page-${page}.json`))).toString('utf8')),
    );
  return { title: index.title, savedAt: index.savedAt, posts, draft };
}

export async function readShuiyuanSnapshotPage(
  topicId: number,
  page: number,
): Promise<ShuiyuanSnapshotPost[]> {
  const selected = await findShuiyuanSnapshot(topicId);
  if (!selected || page >= Math.ceil(selected.index.postCount / selected.index.pageSize)) return [];
  return JSON.parse(
    (await readSnapshotBytes(join(selected.dir, `page-${page}.json`))).toString('utf8'),
  );
}

/** dela-resource://shuiyuan-snapshot/<topicId>/<hash>.<ext>：只放行快照目录内的图片文件，草稿的图片在 .partial 下。 */
export async function handleShuiyuanSnapshotRequest(url: URL): Promise<Response> {
  const match = /^\/(\d+)\/([0-9a-f]{32})\.([a-z]+)$/.exec(url.pathname);
  const type = match && imageTypes.get(match[3]!);
  if (!match || !type) return new Response(null, { status: 404 });
  const file = join('images', `${match[2]}.${match[3]}`);
  const topicId = Number(match[1]);
  if (url.searchParams.has('thumbnail') && ['jpg', 'png', 'webp', 'bmp'].includes(match[3]!)) {
    const key = `${topicId}/${match[2]}`;
    let pending = thumbnails.get(key);
    if (!pending) {
      pending = thumbnailQueue
        .catch(() => {})
        .then(async () => {
          const dir = existsSync(join(snapshotDir(topicId), file))
            ? snapshotDir(topicId)
            : partialDir(topicId);
          const target = join(dir, 'thumbnails', `${match[2]}.jpg`);
          try {
            return await readSnapshotBytes(target);
          } catch {
            /* 首次显示时生成，之后从磁盘复用。 */
          }
          const image = nativeImage.createFromBuffer(await readSnapshotBytes(join(dir, file)));
          if (image.isEmpty()) throw new Error('无法读取快照图片');
          const { width, height } = image.getSize();
          const scale = Math.min(1, 960 / width, 960 / height);
          const bytes = image
            .resize({
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
            })
            .toJPEG(85);
          await mkdir(join(dir, 'thumbnails'), { recursive: true });
          await writeSnapshotBytes(target, bytes);
          return bytes;
        });
      thumbnails.set(key, pending);
      thumbnailQueue = pending.then(
        () => {},
        () => {},
      );
      void pending.finally(() => thumbnails.delete(key)).catch(() => {});
    }
    try {
      return new Response(await pending, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
      });
    } catch {
      /* 不支持的图片保留原图。 */
    }
  }
  const bytes = await readSnapshotBytes(join(snapshotDir(topicId), file)).catch(() =>
    readSnapshotBytes(join(partialDir(topicId), file)),
  );
  return new Response(bytes, {
    headers: {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

const thumbnails = new Map<string, Promise<Buffer>>();
let thumbnailQueue: Promise<void> = Promise.resolve();
