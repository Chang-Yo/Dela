import { z } from 'zod';
import { readMailMessage } from '../../mail/api';
import { getShuiyuanTopic } from '../../shuiyuan/api';
import { shuiyuanPostsHtml, shuiyuanTopicUrl } from '../../shuiyuan/sources';
import { requireShuiyuanBound, withShuiyuanErrors } from './shuiyuan/helpers';
import { resourceRefSchema, type ResourceRef } from '../../../shared/resources';
import {
  readCanvasResource,
  readWorkspaceResource,
  withAttachmentFile,
  type ResourceContent,
} from '../../resources';
import { canvasFilePath } from '../../canvas/api';
import { mailAttachment } from '../../mail/api';
import { workspaceFilePath } from '../../workspace/api';
import type { CommandDomain } from '../../../core/capabilities/commands';
import { resourceResolver, type ResourceResolver } from '../../../core/capabilities/resources';
import { freshness, offset, tool, toolError } from './shared';

type MailRef = Extract<ResourceRef, { type: 'mail' }>;
type ShuiyuanOnlineRef = Extract<ResourceRef, { type: 'shuiyuan-online' }>;

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

async function readShuiyuanOnlineRef(ref: ShuiyuanOnlineRef, offset: number, limit: number) {
  requireShuiyuanBound();
  const detail = await withShuiyuanErrors(() => getShuiyuanTopic(ref.id));
  const text = shuiyuanPostsHtml(detail.posts);
  return {
    ref,
    title: detail.title,
    format: 'html',
    revision: null,
    url: shuiyuanTopicUrl(ref.id),
    freshness: freshness('realtime', detail.lastPostedAt),
    ...(detail.posts.length < detail.stream.length
      ? {
          note: `只读到前 ${detail.posts.length}/${detail.stream.length} 楼，用 read_shuiyuan_topic 与 read_shuiyuan_posts 续读`,
        }
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

function readDocument(ref: ResourceRef, content: ResourceContent, offset: number, limit: number) {
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
    text: text.slice(offset, offset + limit),
    readable: true,
    totalCharacters: text.length,
    nextOffset: offset + limit < text.length ? offset + limit : null,
  };
}

export const readResourceTool = tool(
  '读取项目文本与笔记、Canvas 页面、邮件正文；workspace 水源来源只读本地快照或摘要，shuiyuan-online 只联网读取，失败时不切换来源；图片直接附图。二进制文档与附件返回 document-reading skill 的读取指引，不在 Agent 内解析 Office/PDF。正文按字符分页；HTML 保留原始链接标记。',
  z
    .object({
      ref: resourceRefSchema,
      offset,
      limit: z.number().int().min(1).max(30000).default(12000),
    })
    .strict(),
  async ({ ref, offset, limit }) => {
    try {
      return await resourceResolver(ref.type).read(ref, offset, limit);
    } catch (error) {
      throw refineReadError(error);
    }
  },
);

// 过渡期各类引用的解析器：迁入各自模块后由模块注册。
export const builtinResourceResolvers: {
  [Type in ResourceRef['type']]: ResourceResolver<Extract<ResourceRef, { type: Type }>>;
} = {
  workspace: {
    read: async (ref, offset, limit) =>
      readDocument(ref, await readWorkspaceResource(ref.id), offset, limit),
    path: (ref) => workspaceFilePath(ref.id),
  },
  canvas: {
    read: async (ref, offset, limit) =>
      readDocument(ref, await readCanvasResource(ref.id), offset, limit),
    path: (ref) => canvasFilePath(ref.id),
  },
  attachment: {
    read: async (ref) =>
      documentHint(ref, mailAttachment(ref.messageId, ref.part).attachment.filename, 'file'),
    withFile: (ref, consume) => withAttachmentFile(ref.messageId, ref.part, consume),
  },
  mail: { read: readMailRef },
  'shuiyuan-online': { read: readShuiyuanOnlineRef },
};

export const resourceDomain = {
  name: 'resource',
  description: '读取项目文件、笔记、Canvas 页面、邮件与水源正文',
  commands: { read_resource: readResourceTool },
} satisfies CommandDomain;
