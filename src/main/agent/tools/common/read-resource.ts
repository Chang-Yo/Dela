import { z } from 'zod';
import { readCanvasSource } from '../../../canvas/api';
import { readMailMessage } from '../../../mail/api';
import {
  parseDocumentFile,
  parsableDocumentExtension,
  renderPdfPages,
} from '../../../resource-parse';
import { withResourceFile } from '../../../resources';
import { resourceRefSchema } from '../../../../shared/resources';
import { readWorkspaceEntry } from '../../../workspace/api';
import { offset, tool } from '../shared';

export const readResourceTool = tool(
  '读取项目文档、Canvas 正文或邮件。按字符分页；PDF/DOCX/PPTX 提取文字，扫描件无文本层。PDF 可传 pages（页码数组，每次至多 6 页）把整页渲染为图像附给模型，适合扫描件与图表，需要视觉模型。HTML 保留原始链接标记。邮件读取不标记已读。',
  z
    .object({
      ref: resourceRefSchema,
      offset,
      limit: z.number().int().min(1).max(30000).default(12000),
      pages: z.array(z.number().int().min(1)).max(6).optional(),
    })
    .strict(),
  async ({ ref, offset, limit, pages }) => {
    if (ref.type === 'attachment')
      throw new Error('附件请用 copy_file_to_project 导入；暂不支持直接提取附件正文');
    if (pages?.length && ref.type !== 'canvas' && ref.type !== 'workspace')
      throw new Error('pages 仅支持 PDF 文档');
    if (ref.type === 'mail') {
      const mail = await readMailMessage(ref.id);
      const text = mail.bodyText ?? mail.bodyHtml ?? '';
      return {
        ref,
        title: mail.subject,
        format: mail.bodyText !== null ? 'text' : 'html',
        sender: mail.sender,
        to: mail.to,
        cc: mail.cc,
        date: mail.date,
        text: text.slice(offset, offset + limit),
        totalCharacters: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null,
        attachments: mail.attachments.map((a) => ({
          name: a.filename,
          size: a.size,
          ref: a.part ? { type: 'attachment', messageId: mail.id, part: a.part } : null,
        })),
      };
    }
    const content =
      ref.type === 'canvas' ? await readCanvasSource(ref.id) : await readWorkspaceEntry(ref.id);
    const isPdf =
      content.format === 'pdf' ||
      (content.format === 'unsupported' && parsableDocumentExtension(content.title) === 'pdf');
    // 渲染/解析失败（文件缺失、格式损坏）时退回原能力边界，不把预览链接当作正文。
    const parseFailure = (error: unknown, fallback: string) => ({
      ref,
      title: content.title,
      format: content.format,
      revision: content.revision,
      url: content.url,
      readable: false,
      text: undefined,
      totalCharacters: null,
      nextOffset: null,
      parseError: error instanceof Error ? error.message : fallback,
    });
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
      revision: content.revision,
      url: content.url,
      text: text?.slice(offset, offset + limit),
      readable: text !== undefined,
      totalCharacters: text?.length ?? null,
      nextOffset: text !== undefined && offset + limit < text.length ? offset + limit : null,
    };
  },
);
