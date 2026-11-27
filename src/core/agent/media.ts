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
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_TEXT_ATTACHMENT_MAX_BYTES,
  chatFileKind,
} from '../protocol/chat-input';
import type { ChatMediaView } from '../protocol/agent';
import { SNIFF_BYTES } from '../protocol/files';
import { readDisabledTools } from '../capabilities/tools';
import { hostPorts } from '../ports';

// 内联图片暂存在 userData/chat-media/<UUID>.<ext>：模型拿到的是 base64（随 Pi 会话落盘），
// 文档同样保留本地副本供 read_document 按需读取；文本附件只进内存。启动时按会话引用回收孤儿文件。
const attachments = new Map<string, { name: string } & ({ bytes: Buffer } | { path: string })>();

function assertDocumentTool(): void {
  if (readDisabledTools().has('read_document'))
    throw new Error('请先在 设置 › 内置能力 › 文档 配置 MinerU Token');
}

function mediaDir(): string {
  const dir = join(hostPorts().paths.userData(), 'chat-media');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeExtension(name: string): string {
  return (/\.[A-Za-z0-9]+$/.exec(name)?.[0] ?? '').toLowerCase();
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
    assertDocumentTool();
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
      previewUrl: hostPorts().imageCodec.previewDataUrl(bytes),
    };
  }
  if (bytes.length > CHAT_TEXT_ATTACHMENT_MAX_BYTES) throw new Error('文本附件超过 1 MB 上限');
  const id = randomUUID();
  attachments.set(id, { name, bytes });
  return { id, name, size: bytes.length, kind: 'attachment', previewUrl: null };
}

export function stageChatMediaFiles(paths: readonly string[]): ChatMediaView[] {
  const picked: ChatMediaView[] = [];
  try {
    for (const path of paths) {
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
      if (kind === 'document') assertDocumentTool();
      picked.push(stageChatMedia(basename(path), readFileSync(path)));
    }
    return picked;
  } catch (error) {
    releaseChatMedia(picked.map(({ id }) => id));
    throw error;
  }
}

export function chatMediaPath(id: string): string | undefined {
  if (!isUuid(id)) return;
  const directory = mediaDir();
  const file = readdirSync(directory, { withFileTypes: true }).find(
    (entry) => entry.isFile() && (entry.name === id || entry.name.startsWith(id + '.')),
  );
  return file && join(directory, file.name);
}

export function readChatMediaBytes(id: string): Buffer {
  if (!isUuid(id)) throw new Error('文件引用无效');
  const attachment = attachments.get(id);
  if (attachment) return 'bytes' in attachment ? attachment.bytes : readFileSync(attachment.path);
  const path = chatMediaPath(id);
  if (path) return readFileSync(path);
  throw new Error('文件不存在或已过期，请重新添加');
}

export function readChatAttachment(id: string) {
  const attachment = attachments.get(id);
  if (!attachment) throw new Error('附件不存在或已发送，请重新添加');
  if ('path' in attachment) assertDocumentTool();
  return attachment;
}

export function chatAttachmentView(id: string): ChatMediaView {
  const attachment = readChatAttachment(id);
  const size = 'bytes' in attachment ? attachment.bytes.length : statSync(attachment.path).size;
  return { id, name: attachment.name, size, kind: 'attachment', previewUrl: null };
}

export function readChatMediaPreview(id: string): string | null {
  if (!isUuid(id)) return null;
  for (const file of readdirSync(mediaDir())) {
    if (!file.startsWith(id)) continue;
    return hostPorts().imageCodec.previewDataUrl(join(mediaDir(), file));
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

export function releaseChatAttachments(ids: readonly string[]): void {
  for (const id of ids) attachments.delete(id);
}

export function gcChatMedia(): void {
  const referenced = new Set<string>();
  const rows = hostPorts()
    .database()
    .prepare("SELECT file FROM sessions WHERE file != ''")
    .all() as {
    file: string;
  }[];
  for (const { file } of rows) {
    if (!existsSync(file)) continue;
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
