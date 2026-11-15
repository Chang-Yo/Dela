import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../contract';
import { workspaceFilePath } from './api';
import { readWorkspaceResource, type ResourceContent } from './resources';
import type { CommandDomain } from '../../../core/capabilities/commands';
import { resourceResolver, type ResourceResolver } from '../../../core/capabilities/resources';
import { freshness, offset, tool, toolError } from '../../../core/capabilities/domain-tools';

/** 业务层中文错误消息 → 统一错误码（消息保持原文）；未识别的错误原样抛出。 */
function refineReadError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('邮箱未配置')) return toolError('NOT_CONFIGURED', message);
  if (message.includes('不存在') || message.includes('尚未同步'))
    return toolError('NOT_FOUND', message);
  return error;
}

export function documentHint(ref: ResourceRef, title: string, format: string) {
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

export function readDocument(
  ref: ResourceRef,
  content: ResourceContent,
  offset: number,
  limit: number,
) {
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

export const workspaceResourceResolver: ResourceResolver<
  Extract<ResourceRef, { type: 'workspace' }>
> = {
  read: async (ref, offset, limit) =>
    readDocument(ref, await readWorkspaceResource(ref.id), offset, limit),
  path: (ref) => workspaceFilePath(ref.id),
};

export const resourceDomain = {
  name: 'resource',
  description: '读取项目文件、笔记、Canvas 页面、邮件与水源正文',
  commands: { read_resource: readResourceTool },
} satisfies CommandDomain;
