import { z } from 'zod';
import { copyResourceToProject } from '../../../resources';
import { resourceRefSchema } from '../../../../shared/resources';
import { tool, uuid } from '../shared';

export const copyFileToProjectTool = tool(
  '把 Canvas 文件、项目文件或邮件附件复制为工作区文件（本地写），返回新条目引用；适合把资料沉淀进项目长期使用。只需临时读取邮件附件正文时直接 read_resource，不必复制。',
  z.object({ source: resourceRefSchema, parentId: uuid }).strict(),
  copyResourceToProject,
);
