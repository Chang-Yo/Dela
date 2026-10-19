// 邮件 MIME 结构与正文解析：挑正文 part、下载正文并内联 CID 图片、HTML 转纯文本、
// 地址与附件 JSON 的编解码。只依赖 IMAP 连接，不碰数据库。
import type { ImapFlow, MessageStructureObject } from 'imapflow';
import type { MailAddress, MailMessageDetail } from '../../shared/api';

const BODY_MAX_BYTES = 2_000_000;
const SNIPPET_MAX_LENGTH = 220;

export async function drainStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function makeSnippet(text: string): string | null {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_MAX_LENGTH
    ? `${collapsed.slice(0, SNIPPET_MAX_LENGTH)}…`
    : collapsed || null;
}

export interface TextPart {
  part: string;
  type: string;
}

export function pickTextPart(node: MessageStructureObject | undefined): TextPart | null {
  if (!node) return null;
  const stack = [node];
  let plain: TextPart | null = null;
  let html: TextPart | null = null;
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (current.disposition === 'attachment' || current.type === 'message/rfc822') continue;
    if (current.type === 'text/plain' && !plain) {
      plain = { part: current.part ?? '1', type: current.type };
    } else if (current.type === 'text/html' && !html) {
      html = { part: current.part ?? '1', type: current.type };
    }
    for (const child of current.childNodes ?? []) stack.push(child);
  }
  return html ?? plain;
}

export async function downloadHtmlImages(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
  html: string,
): Promise<string> {
  const stack = structure ? [structure] : [];
  // Inline images share the existing body byte budget; oversized images stay as placeholders.
  let remaining = BODY_MAX_BYTES;
  while (stack.length) {
    const node = stack.shift()!;
    if (node.type === 'message/rfc822' || node.disposition === 'attachment') continue;
    stack.push(...(node.childNodes ?? []));
    const cid = node.id?.replace(/^<|>$/g, '');
    if (
      !cid ||
      !node.part ||
      !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(node.type) ||
      !html.includes('cid:')
    )
      continue;
    if (remaining <= 0 || (node.size ?? 0) > remaining) continue;
    const pattern = /cid:([^\s"'<>)]+)/gi;
    const matches = (value: string) => {
      try {
        return decodeURIComponent(value) === cid;
      } catch {
        return value === cid;
      }
    };
    if (![...html.matchAll(pattern)].some((match) => matches(match[1]!))) continue;
    try {
      const download = await client.download(uid, node.part, {
        uid: true,
        maxBytes: remaining + 1,
      });
      const data = await drainStream(download.content);
      if (data.length > remaining) {
        remaining = 0;
        continue;
      }
      remaining -= data.length;
      const url = `data:${node.type};base64,${data.toString('base64')}`;
      html = html.replace(pattern, (full, value: string) => (matches(value) ? url : full));
    } catch {
      // A missing inline image must not prevent reading the message.
    }
  }
  return html;
}

export interface AttachmentItem {
  filename: string;
  size: number | null;
  part: string | null;
}

export async function downloadMessageBody(
  client: ImapFlow,
  uid: number,
  textPart: TextPart,
  structure: MessageStructureObject | undefined,
): Promise<{ text: string; html: string | null }> {
  const download = await client.download(uid, textPart.part, {
    uid: true,
    maxBytes: BODY_MAX_BYTES,
  });
  let content = (await drainStream(download.content)).toString('utf8');
  if (textPart.type !== 'text/html') return { text: content, html: null };
  content = await downloadHtmlImages(client, uid, structure, content);
  return { text: stripHtml(content), html: content };
}

export function collectAttachments(node: MessageStructureObject | undefined): AttachmentItem[] {
  const result: AttachmentItem[] = [];
  if (!node) return result;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (current.disposition === 'attachment' || current.type === 'message/rfc822') {
      const filename =
        current.dispositionParameters?.filename ??
        current.parameters?.name ??
        (current.type === 'message/rfc822' ? '附件邮件.eml' : null);
      if (filename) {
        result.push({ filename, size: current.size ?? null, part: current.part ?? null });
      }
    }
    for (const child of current.childNodes ?? []) stack.push(child);
  }
  return result;
}

export function toIso(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function addressJson(addresses: MailAddress[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  return JSON.stringify(addresses.filter((a) => a.name || a.address));
}

export function parseAddresses(json: string | null): MailAddress[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is MailAddress => typeof item === 'object' && item !== null && 'address' in item,
    );
  } catch {
    return [];
  }
}

export function parseAttachments(json: string | null): MailMessageDetail['attachments'] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as { filename?: unknown; size?: unknown; part?: unknown };
      if (typeof record.filename !== 'string') return [];
      return [
        {
          filename: record.filename,
          size: typeof record.size === 'number' ? record.size : null,
          part: typeof record.part === 'string' ? record.part : null,
        },
      ];
    });
  } catch {
    return [];
  }
}
