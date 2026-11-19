import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freshness } from '../../../core/capabilities/domain-tools';
import type { ResourceResolver } from '../../../core/capabilities/resources';
import { hostPorts } from '../../../core/ports';
import type { ResourceRef } from '../../workspace/contract';
import { diskName, documentHint } from '../../workspace';
import { mailAttachment, readMailMessage, saveMailAttachment } from './api';

type MailRef = Extract<ResourceRef, { type: 'mail' }>;
type AttachmentRef = Extract<ResourceRef, { type: 'attachment' }>;

async function withAttachmentFile<T>(
  messageId: number,
  part: string,
  consume: (path: string) => Promise<T> | T,
): Promise<T> {
  const mail = await readMailMessage(messageId);
  const attachment = mail.attachments.find((item) => item.part === part);
  if (!attachment) throw new Error('附件不存在，请先同步邮件');
  const temporaryDirectory = await mkdtemp(join(hostPorts().paths.temp(), 'dela-attachment-'));
  try {
    const path = join(temporaryDirectory, diskName(attachment.filename));
    await saveMailAttachment(messageId, part, path);
    return await consume(path);
  } finally {
    // Only remove the temporary directory created by this call.
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export const mailResourceResolver: ResourceResolver<MailRef> = {
  async read(ref, offset, limit) {
    const mail = await readMailMessage(ref.id);
    const text = mail.bodyText ?? mail.bodyHtml ?? '';
    return {
      ref,
      title: mail.subject,
      format: mail.bodyText !== null ? 'text' : 'html',
      revision: null,
      sender: mail.sender,
      to: mail.to,
      cc: mail.cc,
      date: mail.date,
      // 正文缺失时 readMailMessage 会联网补齐，读取结果即当前可见内容；邮件不可变，时间以邮件日期为准。
      freshness: freshness('realtime', mail.date ?? undefined),
      text: text.slice(offset, offset + limit),
      totalCharacters: text.length,
      nextOffset: offset + limit < text.length ? offset + limit : null,
      attachments: mail.attachments.map((a) => ({
        name: a.filename,
        size: a.size,
        ref: a.part ? { type: 'attachment' as const, messageId: mail.id, part: a.part } : null,
      })),
    };
  },
};

export const attachmentResourceResolver: ResourceResolver<AttachmentRef> = {
  read: async (ref) =>
    documentHint(ref, mailAttachment(ref.messageId, ref.part).attachment.filename, 'file'),
  withFile: (ref, consume) => withAttachmentFile(ref.messageId, ref.part, consume),
};
