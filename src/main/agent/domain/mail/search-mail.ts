import { getMailState, mailSearchSchema, searchMail } from '../../../mail/api';
import { coverage, freshness, tool, toolError } from '../shared';

export const searchMailTool = tool(
  '搜索已缓存邮件的主题和摘要，可按发件人、日期和文件夹筛选（folderId 取自 list_mail_folders）。只读。不是完整邮箱或正文搜索；未找到不能证明邮件不存在。',
  mailSearchSchema,
  async (input) => {
    const account = getMailState().account;
    if (!account)
      throw toolError('NOT_CONFIGURED', '邮箱未连接：请先在设置的邮件页配置交大邮箱账号');
    const { items, nextOffset, coverage: window } = searchMail(input);
    return {
      items,
      nextOffset,
      freshness: freshness('cached', account.lastSyncedAt),
      coverage: {
        // uid300 与 mail/api.ts 的 SYNC_WINDOW 对应。
        ...coverage('cached_subjects_and_snippets:uid300', false, [
          '仅搜索缓存的主题与摘要，不含正文；每个文件夹只覆盖最近 300 封邮件',
        ]),
        folders: window.folders,
      },
    };
  },
);
