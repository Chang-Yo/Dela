import { mailSearchSchema, searchMail } from '../../../mail/api';
import { tool } from '../shared';

export const searchMailTool = tool(
  '搜索已缓存邮件的主题和摘要，可按发件人、日期和文件夹筛选。不是完整邮箱或正文搜索；未找到不能证明邮件不存在。',
  mailSearchSchema,
  searchMail,
);
