import { z } from 'zod';
import { copyResourceToProject } from '../../../resources';
import { resourceRefSchema } from '../../../../shared/resources';
import { tool, uuid } from '../shared';

export const copyFileToProjectTool = tool(
  '复制 Canvas 文件或邮件附件到工作区目录，返回新项目文件引用。',
  z.object({ source: resourceRefSchema, parentId: uuid }).strict(),
  copyResourceToProject,
);
