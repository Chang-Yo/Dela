import { z } from 'zod';
import type { CommandDomain } from '../../../core/capabilities/commands';
import { DOCUMENT_SKILL } from '../../documents/runtime';
import { prepareDocumentResource, releaseDocumentResource } from '../../resources';
import { resourceRefSchema } from '../../../shared/resources';
import skill from '../skills/document-reading/SKILL.md?raw';
import script from '../skills/document-reading/scripts/read.py?raw';
import { tool } from './shared';

export const documentDomain = {
  name: 'document',
  description: '为文档读取 skill 准备与清理 PDF、Office 等文档的临时文件',
  skill: {
    name: DOCUMENT_SKILL,
    files: [
      { path: 'SKILL.md', content: skill },
      { path: 'scripts/read.py', content: script },
    ],
  },
  commands: {
    prepare_document: tool(
      '为文档读取 skill 准备临时文件和工具路径，不解析正文、不复制进项目；需要已安装文档组件。',
      z.object({ ref: resourceRefSchema }).strict(),
      ({ ref }) => prepareDocumentResource(ref),
    ),
    release_document: tool(
      '清理 prepare_document 生成的临时输入与输出；完成正文和图片读取后调用。',
      z.object({ jobId: z.string() }).strict(),
      async ({ jobId }) => {
        await releaseDocumentResource(jobId);
        return { released: true };
      },
    ),
  },
} satisfies CommandDomain;
