import { z } from 'zod';
import { readCanvasSource } from '../../../canvas/api';
import { mailAttachment, readMailMessage } from '../../../mail/api';
import {
  parseDocumentFile,
  parsableDocumentExtension,
  renderPdfPages,
} from '../../../resource-parse';
import { withResourceFile } from '../../../resources';
import { readShuiyuanSource } from '../../../shuiyuan/api';
import { resourceRefSchema, type ResourceRef } from '../../../../shared/resources';
import { readWorkspaceEntry } from '../../../workspace/api';
import { freshness, offset, tool, toolError } from '../shared';

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

async function readAttachmentRef(ref: AttachmentRef, offset: number, limit: number) {
  const { attachment } = mailAttachment(ref.messageId, ref.part);
  try {
    const parsed = await withResourceFile(ref, (path) => parseDocumentFile(path));
    return {
      ref,
      title: attachment.filename,
      format: parsed.kind,
      revision: null,
      // 附件字节经 IMAP 按需提取（withResourceFile 的临时文件即用即删，不留存）。
      freshness: freshness('realtime'),
      pages: parsed.pages,
      hasTextLayer: parsed.hasTextLayer,
      ...(parsed.hasTextLayer
        ? {}
        : {
            hint: '附件无文本层（扫描件）；可先 copy_file_to_project 导入，再对导入的 PDF 传 pages 渲染页面图像',
          }),
      text: parsed.text.slice(offset, offset + limit),
      readable: parsed.hasTextLayer,
      totalCharacters: parsed.text.length,
      nextOffset:
        parsed.hasTextLayer && offset + limit < parsed.text.length ? offset + limit : null,
    };
  } catch (error) {
    const kind = parsableDocumentExtension(attachment.filename);
    return {
      ref,
      title: attachment.filename,
      format: kind ?? 'unsupported',
      revision: null,
      freshness: freshness('realtime'),
      readable: false,
      text: undefined,
      totalCharacters: null,
      nextOffset: null,
      parseError: error instanceof Error ? error.message : '附件解析失败',
      ...(kind
        ? {}
        : {
            hint: '仅支持提取 PDF/DOCX/PPTX 附件的文字；其他类型可用 copy_file_to_project 导入项目',
          }),
    };
  }
}

async function readDocumentRef(ref: DocumentRef, offset: number, limit: number, pages?: number[]) {
  const content =
    ref.type === 'canvas' ? await readCanvasSource(ref.id) : await readWorkspaceEntry(ref.id);
  const cached = freshness('cached');
  // 渲染/解析失败（文件缺失、格式损坏）时退回原能力边界，不把预览链接当作正文。
  const parseFailure = (error: unknown, fallback: string) => ({
    ref,
    title: content.title,
    format: content.format,
    revision: content.revision ?? null,
    url: content.url,
    freshness: cached,
    readable: false,
    text: undefined,
    totalCharacters: null,
    nextOffset: null,
    parseError: error instanceof Error ? error.message : fallback,
  });
  const isPdf =
    content.format === 'pdf' ||
    (content.format === 'unsupported' && parsableDocumentExtension(content.title) === 'pdf');
  if (pages?.length) {
    if (!isPdf) throw new Error('pages 仅支持 PDF 文档');
    // images 携带 data URL，由 agent loop 摘出转成图片消息；持久化输出只保留 pageImages 元数据。
    try {
      const rendered = await withResourceFile(ref, (path) => renderPdfPages(path, pages));
      return {
        ref,
        title: content.title,
        format: 'pdf',
        totalPages: rendered.totalPages,
        freshness: cached,
        pageImages: rendered.pages.map(({ page }) => ({ page })),
        images: rendered.pages.map(({ page, jpeg }) => ({
          page,
          dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`,
        })),
        note: '页面图像已作为图片消息附后；文字层内容可用不带 pages 的调用读取。',
      };
    } catch (error) {
      return parseFailure(error, '页面渲染失败');
    }
  }
  // 图片文件（png/jpeg/gif/webp）直接以图片消息附给视觉模型，形状与 PDF pages 的 images 机制一致。
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
  if (
    content.format === 'pdf' ||
    (content.format === 'unsupported' && parsableDocumentExtension(content.title))
  ) {
    try {
      const parsed = await withResourceFile(ref, (path) => parseDocumentFile(path));
      const text = parsed.text;
      return {
        ref,
        title: content.title,
        format: parsed.kind,
        revision: content.revision ?? null,
        freshness: cached,
        pages: parsed.pages,
        hasTextLayer: parsed.hasTextLayer,
        // 扫描件引导：让模型知道可以改走 pages 图像路径。
        ...(parsed.hasTextLayer
          ? {}
          : {
              hint: '扫描件无文本层；若当前模型支持视觉，可传 pages 数组逐页读取页面图像（每次至多 6 页）',
            }),
        text: text.slice(offset, offset + limit),
        readable: parsed.hasTextLayer,
        totalCharacters: text.length,
        nextOffset: parsed.hasTextLayer && offset + limit < text.length ? offset + limit : null,
      };
    } catch (error) {
      return parseFailure(error, '文档解析失败');
    }
  }
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
  '读取资源正文：项目文档与笔记、Canvas 资料、邮件正文、邮件附件、水源帖子。只读（邮件正文与附件缺失时按需联网拉取并写缓存；不标记已读，附件临时提取不留存）。按字符分页，返回 text/totalCharacters/nextOffset；PDF/DOCX/PPTX 提取文字，扫描件可传 pages（每次至多 6 页）把整页渲染为图像（需视觉模型）；图片文件直接附图。HTML 保留原始链接标记。',
  z
    .object({
      ref: resourceRefSchema,
      offset,
      limit: z.number().int().min(1).max(30000).default(12000),
      pages: z.array(z.number().int().min(1)).max(6).optional(),
    })
    .strict(),
  async ({ ref, offset, limit, pages }) => {
    if (pages?.length && ref.type !== 'canvas' && ref.type !== 'workspace')
      throw new Error('pages 仅支持 PDF 文档');
    try {
      switch (ref.type) {
        case 'mail':
          return await readMailRef(ref, offset, limit);
        case 'shuiyuan-topic':
          return await readShuiyuanRef(ref, offset, limit);
        case 'attachment':
          return await readAttachmentRef(ref, offset, limit);
        default:
          return await readDocumentRef(ref, offset, limit, pages);
      }
    } catch (error) {
      throw refineReadError(error);
    }
  },
);
