import { BrowserWindow, app, dialog, nativeImage, type NativeImage } from 'electron';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMediaView } from '../../shared/api';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKind,
} from '../../shared/chat-input';
import { SNIFF_BYTES } from '../../shared/files';
import { getDatabase } from '../database';
import { DOCUMENT_SKILL, assertDocumentDependency } from '../documents/runtime';
import { readDisabledSkills } from './skills';

// 内联图片暂存在 userData/chat-media/<UUID>.<ext>：模型拿到的是 base64（随 Pi 会话落盘），
// 文档同样保留本地副本供 skill 按需读取；文本附件只进内存。启动时按会话引用回收孤儿文件。
const attachments = new Map<string, { name: string } & ({ bytes: Buffer } | { path: string })>();

function assertDocumentSkill(): void {
  assertDocumentDependency();
  if (readDisabledSkills().has(DOCUMENT_SKILL)) throw new Error('请先在设置 › Skills 启用文档读取');
}

function mediaDir(): string {
  const dir = join(app.getPath('userData'), 'chat-media');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeExtension(name: string): string {
  return (/\.[A-Za-z0-9]+$/.exec(name)?.[0] ?? '').toLowerCase();
}

function previewDataUrl(image: NativeImage): string | null {
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return (size.width > 480 ? image.resize({ width: 480, quality: 'good' }) : image).toDataURL();
}

function readHead(path: string, size: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, SNIFF_BYTES));
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0));
  } finally {
    closeSync(fd);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function stageChatMedia(name: string, bytes: Buffer): ChatMediaView {
  const kind = chatFileKind(name, bytes);
  if (kind === 'document') {
    assertDocumentSkill();
    if (bytes.length > CHAT_DOCUMENT_MAX_BYTES) throw new Error('文档附件超过 128 MiB 上限');
    const id = randomUUID();
    const path = join(mediaDir(), id + safeExtension(name));
    writeFileSync(path, bytes);
    attachments.set(id, { name, path });
    return { id, name, size: bytes.length, kind: 'attachment', previewUrl: null };
  }
  if (kind === 'image') {
    if (bytes.length > CHAT_IMAGE_MAX_BYTES) throw new Error('图片超过 5 MB 上限');
    const id = randomUUID();
    writeFileSync(join(mediaDir(), id + safeExtension(name)), bytes);
    return {
      id,
      name,
      size: bytes.length,
      kind: 'image',
      previewUrl: previewDataUrl(nativeImage.createFromBuffer(bytes)),
    };
  }
  if (bytes.length > CHAT_TEXT_ATTACHMENT_MAX_BYTES) throw new Error('文本附件超过 1 MB 上限');
  const id = randomUUID();
  attachments.set(id, { name, bytes });
  return { id, name, size: bytes.length, kind: 'attachment', previewUrl: null };
}

export async function pickChatMedia(owner: BrowserWindow): Promise<ChatMediaView[]> {
  const result = await dialog.showOpenDialog(owner, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '文件', extensions: ['*'] }],
  });
  if (result.canceled) return [];
  const picked: ChatMediaView[] = [];
  try {
    for (const path of result.filePaths) {
      const stat = statSync(path);
      if (!stat.isFile()) continue;
      const kind = chatFileKind(basename(path), readHead(path, stat.size), stat.size > SNIFF_BYTES);
      const limit =
        kind === 'image'
          ? CHAT_IMAGE_MAX_BYTES
          : kind === 'text'
            ? CHAT_TEXT_ATTACHMENT_MAX_BYTES
            : CHAT_DOCUMENT_MAX_BYTES;
      if (stat.size > limit)
        throw new Error(`“${basename(path)}”超过 ${limit / 1024 / 1024} MiB 上限`);
      if (kind === 'document') assertDocumentSkill();
      picked.push(stageChatMedia(basename(path), readFileSync(path)));
    }
    return picked;
  } catch (error) {
    releaseChatMedia(picked.map(({ id }) => id));
    throw error;
  }
}

/** 图片与文档来自磁盘，文本附件来自内存。 */
export function readChatMediaBytes(id: string): Buffer {
  if (!isUuid(id)) throw new Error('文件引用无效');
  const attachment = attachments.get(id);
  if (attachment) return 'bytes' in attachment ? attachment.bytes : readFileSync(attachment.path);
  for (const file of readdirSync(mediaDir())) {
    if (file.startsWith(id)) return readFileSync(join(mediaDir(), file));
  }
  throw new Error('文件不存在或已过期，请重新添加');
}

export function readChatAttachment(id: string) {
  const attachment = attachments.get(id);
  if (!attachment) throw new Error('附件不存在或已发送，请重新添加');
  if ('path' in attachment) assertDocumentSkill();
  return attachment;
}

export function readChatMediaPreview(id: string): string | null {
  if (!isUuid(id)) return null;
  for (const file of readdirSync(mediaDir())) {
    if (!file.startsWith(id)) continue;
    return previewDataUrl(nativeImage.createFromPath(join(mediaDir(), file)));
  }
  return null;
}

export function releaseChatMedia(ids: readonly string[]): void {
  for (const id of ids) {
    if (!isUuid(id)) continue;
    attachments.delete(id);
    for (const file of readdirSync(mediaDir())) {
      if (file.startsWith(id)) rmSync(join(mediaDir(), file));
    }
  }
}

/** 释放附件的内存索引；图片与文档落盘文件由消息引用，交给 GC。 */
export function releaseChatAttachments(ids: readonly string[]): void {
  for (const id of ids) attachments.delete(id);
}

/** 删除没有被任何会话引用的图片/文档文件；引用记在 Pi 会话用户消息元数据里。 */
export function gcChatMedia(): void {
  const referenced = new Set<string>();
  const rows = getDatabase().prepare("SELECT file FROM sessions WHERE file != ''").all() as {
    file: string;
  }[];
  for (const { file } of rows) {
    if (!existsSync(file)) continue;
    // 图片 id 只出现在该会话用户消息的元数据里：按 UUID 形状整文件匹配即可。
    for (const [id] of readFileSync(file, 'utf8').matchAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    ))
      referenced.add(id);
  }
  for (const file of readdirSync(mediaDir())) {
    const id = file.slice(0, 36);
    if (!isUuid(id) || referenced.has(id)) continue;
    rmSync(join(mediaDir(), file));
  }
}
