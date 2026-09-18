import { BrowserWindow, app, dialog, nativeImage } from 'electron';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMediaView } from '../../shared/api';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKind,
  imageFileExtensions,
  textFileExtensions,
} from '../../shared/chat-input';
import { getDatabase } from '../database';

// 已发送的内联图片持久化在 userData/chat-media/<UUID>.<ext>，消息 JSON 只保存 id；
// 文本附件只进内存并在发送后释放，不落盘。启动时按会话引用回收孤儿文件。
const attachments = new Map<string, { name: string; bytes: Buffer }>();

function mediaDir(): string {
  const dir = join(app.getPath('userData'), 'chat-media');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeExtension(name: string): string {
  return (/\.[A-Za-z0-9]+$/.exec(name)?.[0] ?? '').toLowerCase();
}

function imagePreview(bytes: Buffer): string | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  const preview = size.width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
  return preview.toDataURL();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function stageChatMedia(name: string, bytes: Buffer): ChatMediaView {
  const kind = chatFileKind(name);
  if (!kind) throw new Error('仅支持图片（png/jpg/jpeg/gif/webp）与常见文本文件');
  if (kind === 'image') {
    if (bytes.length > CHAT_IMAGE_MAX_BYTES) throw new Error('图片超过 5 MB 上限');
    const id = randomUUID();
    writeFileSync(join(mediaDir(), id + safeExtension(name)), bytes);
    return { id, name, size: bytes.length, kind: 'image', previewUrl: imagePreview(bytes) };
  }
  if (bytes.length > CHAT_TEXT_ATTACHMENT_MAX_BYTES) throw new Error('文本附件超过 1 MB 上限');
  const id = randomUUID();
  attachments.set(id, { name, bytes });
  return { id, name, size: bytes.length, kind: 'attachment', previewUrl: null };
}

export async function pickChatMedia(owner: BrowserWindow): Promise<ChatMediaView[]> {
  const result = await dialog.showOpenDialog(owner, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片与文本', extensions: [...imageFileExtensions, ...textFileExtensions] }],
  });
  if (result.canceled) return [];
  const picked: ChatMediaView[] = [];
  for (const path of result.filePaths) {
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    picked.push(stageChatMedia(basename(path), readFileSync(path)));
  }
  return picked;
}

/** 读取暂存内容：图片来自磁盘，附件来自内存。 */
export function readChatMediaBytes(id: string): Buffer {
  if (!isUuid(id)) throw new Error('文件引用无效');
  const attachment = attachments.get(id);
  if (attachment) return attachment.bytes;
  for (const file of readdirSync(mediaDir())) {
    if (file.startsWith(id)) return readFileSync(join(mediaDir(), file));
  }
  throw new Error('文件不存在或已过期，请重新添加');
}

export function readChatAttachment(id: string): { name: string; bytes: Buffer } {
  const attachment = attachments.get(id);
  if (!attachment) throw new Error('附件不存在或已发送，请重新添加');
  return attachment;
}

export function readChatMediaPreview(id: string): string | null {
  if (!isUuid(id)) return null;
  for (const file of readdirSync(mediaDir())) {
    if (!file.startsWith(id)) continue;
    const image = nativeImage.createFromPath(join(mediaDir(), file));
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const preview = size.width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
    return preview.toDataURL();
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

/** 附件内容进入当轮上下文后立即释放内存；图片落盘文件由消息引用，交给 GC。 */
export function releaseChatAttachments(ids: readonly string[]): void {
  for (const id of ids) attachments.delete(id);
}

/** 删除没有被任何会话消息引用的图片文件；在应用启动、数据库可用后调用。 */
export function gcChatMedia(): void {
  const referenced = new Set<string>();
  const rows = getDatabase().prepare('SELECT messages FROM chat_sessions').all() as {
    messages: string;
  }[];
  for (const row of rows) {
    try {
      for (const message of JSON.parse(row.messages) as { images?: { id: string }[] }[]) {
        for (const image of message.images ?? []) {
          if (isUuid(image.id)) referenced.add(image.id);
        }
      }
    } catch {
      // 单条会话 JSON 异常不阻塞其余回收。
    }
  }
  for (const file of readdirSync(mediaDir())) {
    const id = file.slice(0, 36);
    if (!isUuid(id) || referenced.has(id)) continue;
    rmSync(join(mediaDir(), file));
  }
}
