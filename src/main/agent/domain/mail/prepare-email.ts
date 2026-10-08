import { emailDraftSchema, prepareEmail } from '../../../mail/drafts';
import { tool } from '../shared';

export const prepareEmailTool = tool(
  '准备可供用户检查和发送的邮件草稿（本地写：只创建草稿记录，不发送邮件）。可附加项目文件、Canvas 文件或邮件附件引用；附件在用户打开草稿时加载。',
  emailDraftSchema,
  prepareEmail,
);
