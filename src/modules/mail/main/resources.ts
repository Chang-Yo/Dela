import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { freshness, toolError } from '../../../core/capabilities/domain-tools';
import type { ResourceResolver } from '../../../core/capabilities/resources';
import { hostPorts } from '../../../core/ports';
import { diskName, documentHint } from '../../workspace';
import { mailAttachment, readMailMessage, saveMailAttachment } from './api';

const messageId = z.number().int().positive().safe();

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

async function readMail(id: number) {
  try {
    return await readMailMessage(id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('邮箱未配置'))
      throw toolError('NOT_CONFIGURED', error.message);
    throw error;
  }
}

export const mailResourceResolver: ResourceResolver<{ type: 'mail'; id: number }> = {
  schema: z.object({ type: z.literal('mail'), id: messageId }).strict(),
  description: '{"type":"mail","id":<邮件 id>}：邮件正文，结果附带附件的地址',
  async read(ref, offset, limit) {
    const mail = await readMail(ref.id);
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

export const attachmentResourceResolver: ResourceResolver<{
  type: 'attachment';
  messageId: number;
  part: string;
}> = {
  schema: z
    .object({
      type: z.literal('attachment'),
      messageId,
      part: z.string().regex(/^\d+(?:\.\d+)*$/),
    })
    .strict(),
  description:
    '{"type":"attachment","messageId":<邮件 id>,"part":"<附件编号>"}：邮件附件，正文用 document-reading skill 读取',
  read: async (ref) =>
    documentHint(ref, mailAttachment(ref.messageId, ref.part).attachment.filename, 'file'),
  withFile: (ref, consume) => withAttachmentFile(ref.messageId, ref.part, consume),
};
