import { z } from 'zod';
import { workspaceEntryIdSchema } from '../contract';
import { workspaceFilePath } from './api';
import { readWorkspaceResource, type ResourceContent } from './resources';
import { workspaceSource } from './sources';
import type { CommandDomain } from '../../../core/capabilities/commands';
import {
  resourceAddressGuide,
  resourceAddressSchema,
  resourceResolver,
  type ResourceResolver,
} from '../../../core/capabilities/resources';
import type { ResourceAddress } from '../../../core/protocol/workbench';
import { freshness, offset, toolError } from '../../../core/capabilities/domain-tools';

/** 业务层中文错误消息 → 统一错误码（消息保持原文）；未识别的错误原样抛出。 */
function refineReadError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('不存在') || message.includes('尚未同步'))
    return toolError('NOT_FOUND', message);
  return error;
}

export function documentHint(ref: ResourceAddress, title: string, format: string) {
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
  ref: ResourceAddress,
  content: ResourceContent,
  offset: number,
  limit: number,
) {
  const cached = freshness('cached');
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

const readResourceSchema = z
  .object({
    ref: resourceAddressSchema,
    offset,
    limit: z.number().int().min(1).max(30000).default(12000),
  })
  .strict();

async function readResource(input: unknown) {
  const { ref, offset, limit } = readResourceSchema.parse(input);
  try {
    return await resourceResolver(ref.type).read(ref, offset, limit);
  } catch (error) {
    throw refineReadError(error);
  }
}

export const workspaceResourceResolver: ResourceResolver<{ type: 'workspace'; id: string }> = {
  schema: z.object({ type: z.literal('workspace'), id: workspaceEntryIdSchema }).strict(),
  description:
    '{"type":"workspace","id":"<条目 id 或绝对路径>"}：项目里的文件、笔记与快捷方式，快捷方式读其所指的资料',
  read: async (ref, offset, limit) =>
    readDocument(ref, await readWorkspaceResource(ref.id), offset, limit),
  path: (ref) => workspaceFilePath(ref.id),
};

/** 项目快捷方式所指的资料，未加入项目时也能按同一 id 读取，交给认领该 id 的模块。 */
export const sourceResourceResolver: ResourceResolver<{ type: 'source'; id: string }> = {
  schema: z.object({ type: z.literal('source'), id: z.string().min(1).max(512) }).strict(),
  description: '{"type":"source","id":"<资料 id>"}：尚未加入项目、只在搜索结果等处出现的资料',
  read: async (ref, offset, limit) =>
    readDocument(ref, await workspaceSource(ref.id).read(ref.id), offset, limit),
  async path(ref) {
    const source = workspaceSource(ref.id);
    if (!source.filePath) throw new Error('该资料没有对应的文件');
    return source.filePath(ref.id);
  },
};

export const resourceDomain = {
  name: 'resource',
  description: '按资源地址读取项目文件与各功能登记的资料',
  commands: {
    read_resource: {
      get description() {
        return `按资源地址读取正文，按字符分页；图片直接附图，HTML 保留原始链接标记，Office/PDF 等二进制文档返回 document-reading skill 的读取指引。可用的地址：\n${resourceAddressGuide()}`;
      },
      schema: readResourceSchema,
      execute: readResource,
    },
  },
} satisfies CommandDomain;
