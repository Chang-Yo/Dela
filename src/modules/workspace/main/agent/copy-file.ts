import { z } from 'zod';
import { copyResourceToProject } from '../resources';
import { workspaceEntryIdSchema } from '../../contract';
import { resourceAddressSchema } from '../../../../core/capabilities/resources';
import { tool } from '../../../../core/capabilities/domain-tools';

export const copyFileToProjectTool = tool(
  '把资源地址指向的文件（项目文件、资料文件、邮件附件等）复制为工作区文件（本地写），返回新文件路径；适合把资料沉淀进项目长期使用。只需临时读取正文时用 dela read_resource 命令，不必复制。',
  z.object({ source: resourceAddressSchema, parentId: workspaceEntryIdSchema }).strict(),
  copyResourceToProject,
);
