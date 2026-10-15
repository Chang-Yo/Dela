import { z } from 'zod';
import { readCanvasSource } from '../../canvas/api';
import { mailAttachment, readMailMessage } from '../../mail/api';
import { readShuiyuanSource } from '../../shuiyuan/api';
import { assertShuiyuanEnabled } from '../../settings/prefs';
import { resourceRefSchema, type ResourceRef } from '../../../shared/resources';
import { readWorkspaceEntry } from '../../workspace/api';
import { freshness, offset, tool, toolError } from './shared';

type MailRef = Extract<ResourceRef, { type: 'mail' }>;
type ShuiyuanRef = Extract<ResourceRef, { type: 'shuiyuan-topic' }>;
type AttachmentRef = Extract<ResourceRef, { type: 'attachment' }>;
type DocumentRef = Extract<ResourceRef, { type: 'canvas' | 'workspace' }>;

/** 业务层中文错误消息 → 统一错误码（消息保持原文）；未识别的错误原样抛出。 */
function refineReadError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('邮箱未配置')) return toolError('NOT_CONFIGURED', message);
  if (message.includes('不存在') || message.includes('尚未同步'))
    return toolError('NOT_FOUND', message);
  return error;
}

async function readMailRef(ref: MailRef, offset: number, limit: number) {
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
}

async function readShuiyuanRef(ref: ShuiyuanRef, offset: number, limit: number) {
  const content = await readShuiyuanSource(ref.id);
  const text = content.text ?? '';
  // readShuiyuanSource 实时路径固定返回 html；format 为 text 即断网回退的本地摘要。
  const degraded = content.format === 'text';
  return {
    ref,
    title: content.title,
    format: content.format,
    revision: null,
    url: content.url,
    freshness: degraded
      ? freshness('cached')
      : freshness('realtime', content.updatedAt ?? undefined),
    ...(degraded
      ? { degraded: true, note: '水源站点不可达，已回退本地缓存的帖子摘要，内容不完整' }
      : {}),
    text: text.slice(offset, offset + limit),
    totalCharacters: text.length,
    nextOffset: offset + limit < text.length ? offset + limit : null,
  };
}

function documentHint(ref: ResourceRef, title: string, format: string) {
  return {
    ref,
    title,
    format,
    readable: false,
    totalCharacters: null,
    nextOffset: null,
    hint: '使用 document-reading skill：先调用 dela prepare_document 获取临时文件和工具路径，再提取正文或查看页面图片；未安装时在设置 › Skills 安装文档读取组件。',
  };
}

async function readAttachmentRef(ref: AttachmentRef, _offset: number, _limit: number) {
  const { attachment } = mailAttachment(ref.messageId, ref.part);
  return documentHint(ref, attachment.filename, 'file');
}

async function readDocumentRef(ref: DocumentRef, offset: number, limit: number) {
  const content =
    ref.type === 'canvas' ? await readCanvasSource(ref.id) : await readWorkspaceEntry(ref.id);
  const cached = freshness('cached');
  // 图片直接作为图片消息附给视觉模型。
  if (content.format === 'image' && content.bytes && content.mime) {
    return {
      ref,
      title: content.title,
      format: 'image',
      revision: content.revision ?? null,
      freshness: cached,
      pageImages: [{ page: 1 }],
      images: [
        {
          page: 1,
          dataUrl: `data:${content.mime};base64,${Buffer.from(content.bytes).toString('base64')}`,
        },
      ],
      note: '图片已作为图片消息附后。',
    };
  }
  if (content.text === undefined) return documentHint(ref, content.title, content.format);
  const text = content.text;
  return {
    ref,
    title: content.title,
    format: content.format,
    revision: content.revision ?? null,
    url: content.url,
    freshness: cached,
    text: text?.slice(offset, offset + limit),
    readable: text !== undefined,
    totalCharacters: text?.length ?? null,
    nextOffset: text !== undefined && offset + limit < text.length ? offset + limit : null,
  };
}

export const readResourceTool = tool(
  '读取项目文本与笔记、Canvas 页面、邮件正文、水源帖子；图片直接附图。二进制文档与附件返回 document-reading skill 的读取指引，不在 Agent 内解析 Office/PDF。正文按字符分页；HTML 保留原始链接标记。',
  z
    .object({
      ref: resourceRefSchema,
      offset,
      limit: z.number().int().min(1).max(30000).default(12000),
    })
    .strict(),
  async ({ ref, offset, limit }) => {
    try {
      switch (ref.type) {
        case 'mail':
          return await readMailRef(ref, offset, limit);
        case 'shuiyuan-topic':
          assertShuiyuanEnabled();
          return await readShuiyuanRef(ref, offset, limit);
        case 'attachment':
          return await readAttachmentRef(ref, offset, limit);
        default:
          return await readDocumentRef(ref, offset, limit);
      }
    } catch (error) {
      throw refineReadError(error);
    }
  },
);
