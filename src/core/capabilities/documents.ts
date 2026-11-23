// 文档读取：PDF、Office 与图片上传到 MinerU 精准解析，Token 由用户自备并加密保存。
// 结果按文件内容缓存在临时目录，续读与重读不再上传，也不再消耗用户的解析额度。
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, openAsBlob } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileTypeFromBlob } from 'file-type';
import { fromBufferPromise } from 'yauzl';
import { z } from 'zod';
import { CredentialDecryptionError, hostPorts, registerSecretLabel } from '../ports';
import { resourceAddressSchema, withResourceFile } from './resources';

const API = 'https://mineru.net/api/v4';
const TOKEN = 'mineru-token';
const FILE_BYTE_LIMIT = 200 * 1024 * 1024;
const TEXT_LIMIT = 20000;
const POLL_INTERVAL_MS = 3000;
const PARSE_TIMEOUT_MS = 15 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'jp2',
  'webp',
  'gif',
  'bmp',
]);
const TOKEN_HINT = '请在 设置 › 内置能力 › 文档 中配置 MinerU Token';

registerSecretLabel(TOKEN, 'MinerU 凭据');

export function hasDocumentToken(): boolean {
  try {
    return hostPorts().secrets.read(TOKEN) !== null;
  } catch (error) {
    if (error instanceof CredentialDecryptionError) return false;
    throw error;
  }
}

/** 查询一个不存在的任务：有效 Token 得到「任务不存在」，无效得到 401；不提交任务，不耗额度。 */
export async function saveDocumentToken(token: string): Promise<void> {
  const trimmed = z.string().trim().min(1, '请粘贴 MinerU Token').max(4096).parse(token);
  await request(trimmed, '/extract/task/00000000-0000-0000-0000-000000000000');
  hostPorts().secrets.write(TOKEN, trimmed);
}

export function removeDocumentToken(): void {
  hostPorts().secrets.remove(TOKEN);
}

const envelopeSchema = z.object({
  code: z.unknown(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
});
const uploadSchema = z.object({ batch_id: z.string(), file_urls: z.array(z.string()).length(1) });
const resultSchema = z.object({
  extract_result: z
    .array(
      z.object({
        state: z.string(),
        full_zip_url: z.string().optional(),
        err_msg: z.string().optional(),
      }),
    )
    .length(1),
});

async function request(token: string, path: string, init: RequestInit = {}) {
  const response = await hostPorts().network.fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (response.status === 401) throw new Error(`MinerU Token 无效或已过期，${TOKEN_HINT}`);
  if (!response.ok) throw new Error(`MinerU 请求失败（HTTP ${response.status}）`);
  return envelopeSchema.parse(await response.json());
}

async function mineru<T>(token: string, path: string, schema: z.ZodType<T>, init?: RequestInit) {
  const body = await request(token, path, init);
  if (body.code !== 0) throw new Error(`MinerU：${body.msg ?? '请求失败'}（${String(body.code)}）`);
  return schema.parse(body.data);
}

async function extract(
  token: string,
  path: string,
  name: string,
  ocr: boolean,
  signal?: AbortSignal,
) {
  const { batch_id, file_urls } = await mineru(token, '/file-urls/batch', uploadSchema, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      files: [{ name, is_ocr: ocr }],
      model_version: 'vlm',
      language: 'ch',
      enable_formula: true,
      enable_table: true,
    }),
  });
  // 签名地址不接受 Content-Type；openAsBlob 的空类型不会带上这个头。
  const upload = await hostPorts().network.fetch(file_urls[0]!, {
    method: 'PUT',
    body: await openAsBlob(path),
    signal,
  });
  if (!upload.ok) throw new Error(`上传到 MinerU 失败（HTTP ${upload.status}）`);
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  for (;;) {
    await delay(POLL_INTERVAL_MS, undefined, { signal });
    const [result] = (
      await mineru(token, `/extract-results/batch/${batch_id}`, resultSchema, { signal })
    ).extract_result;
    if (result!.state === 'done' && result!.full_zip_url) {
      const archive = await hostPorts().network.fetch(result!.full_zip_url, { signal });
      if (!archive.ok) throw new Error(`下载 MinerU 解析结果失败（HTTP ${archive.status}）`);
      return Buffer.from(await archive.arrayBuffer());
    }
    if (result!.state === 'failed')
      throw new Error(`MinerU 解析失败：${result!.err_msg || '未知原因'}`);
    if (Date.now() > deadline) throw new Error('MinerU 解析超过 15 分钟仍未完成，请稍后重试');
  }
}

/** 只取正文与 images/ 下的图片，其余中间文件与压缩包里的路径一概不落盘。 */
async function unpack(archive: Buffer, directory: string): Promise<string> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, 'images'), { recursive: true });
  const zip = await fromBufferPromise(archive, { lazyEntries: true });
  let markdown = '';
  for await (const entry of zip.eachEntry()) {
    const image = /^images\/([\w.-]+)$/.exec(entry.fileName)?.[1];
    if (entry.fileName !== 'full.md' && !image) continue;
    const data = await buffer(await zip.openReadStreamPromise(entry));
    if (image) await writeFile(join(directory, 'images', image), data);
    else markdown = data.toString('utf8');
  }
  return markdown;
}

/** MinerU 按扩展名判断格式；附件等文件名不可靠时按内容识别。 */
async function extension(path: string, name: string): Promise<string> {
  const named = extname(name).slice(1).toLowerCase();
  if (EXTENSIONS.has(named)) return named;
  const detected = (await fileTypeFromBlob(await openAsBlob(path)))?.ext ?? '';
  if (EXTENSIONS.has(detected)) return detected;
  throw new Error('不支持的文档格式：只能读取 PDF、Word、PowerPoint、Excel 与图片');
}

async function contentHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function parseCached(
  token: string,
  root: string,
  path: string,
  name: string,
  signal?: AbortSignal,
) {
  const directory = join(root, await contentHash(path));
  const content = join(directory, 'content.md');
  if (existsSync(content)) return { directory, markdown: await readFile(content, 'utf8') };
  if ((await stat(path)).size > FILE_BYTE_LIMIT) throw new Error('文档超过 MinerU 的 200 MB 上限');
  const upload = `document.${await extension(path, name)}`;
  const staging = `${directory}.${randomUUID()}`;
  try {
    let markdown = await unpack(await extract(token, path, upload, false, signal), staging);
    if (!markdown.trim())
      markdown = await unpack(await extract(token, path, upload, true, signal), staging);
    const linked = markdown.replaceAll('](images/', `](${directory}${sep}images${sep}`);
    await writeFile(join(staging, 'content.md'), linked);
    // 同一文件并发解析时先到者生效，后到者的结果丢弃。
    await rename(staging, directory).catch(() => {});
    return { directory, markdown: linked };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const inputSchema = z
  .object({ ref: resourceAddressSchema, offset: z.number().int().min(0).optional() })
  .strict();

export async function readDocument(input: unknown, signal?: AbortSignal) {
  const { ref, offset = 0 } = inputSchema.parse(input);
  const token = hostPorts().secrets.read(TOKEN);
  if (!token) throw new Error(`未配置 MinerU Token，${TOKEN_HINT}`);
  const root = join(hostPorts().paths.temp(), 'dela-documents');
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) {
    const path = join(root, entry);
    if (Date.now() - (await stat(path)).mtimeMs > CACHE_MAX_AGE_MS)
      await rm(path, { recursive: true, force: true });
  }
  const [title, { directory, markdown }] = await withResourceFile(
    ref,
    async (path) =>
      [basename(path), await parseCached(token, root, path, basename(path), signal)] as const,
  );
  const images = (await readdir(join(directory, 'images'))).length;
  const nextOffset = offset + TEXT_LIMIT < markdown.length ? offset + TEXT_LIMIT : null;
  const notes = [
    !markdown.trim() && '没有识别出正文，不能声称已读完',
    images > 0 &&
      `正文中的 ${images} 张图片链接指向本机文件，图片内容未解读；需要时用 read 打开对应路径`,
    nextOffset !== null &&
      `正文共 ${markdown.length} 字符，本次返回第 ${offset}–${nextOffset} 字符；传 offset=${nextOffset} 续读，不会重新解析`,
  ].filter(Boolean);
  return {
    title,
    text: markdown.slice(offset, offset + TEXT_LIMIT),
    totalCharacters: markdown.length,
    nextOffset,
    ...(notes.length ? { note: notes.join('；') } : {}),
  };
}
