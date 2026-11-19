import { z } from 'zod';
import { copyResourceToProject } from '../resources';
import { resourceRefSchema, workspaceEntryIdSchema } from '../../contract';
import { tool } from '../../../../core/capabilities/domain-tools';

export const copyFileToProjectTool = tool(
  '把 Canvas 文件、项目文件或邮件附件复制为工作区文件（本地写），返回新文件路径；适合把资料沉淀进项目长期使用。只需临时读取邮件附件正文时用 dela read_resource 命令，不必复制。',
  z.object({ source: resourceRefSchema, parentId: workspaceEntryIdSchema }).strict(),
  copyResourceToProject,
);
