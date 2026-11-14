import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from '../../skills/mail/SKILL.md?raw';
import { listMailFoldersTool } from './list-folders';
import { prepareEmailTool } from './prepare-email';
import { searchMailTool } from './search-mail';

export const mailDomain = {
  name: 'mail',
  description: '检索邮件、读取附件与准备邮件草稿',
  skill: { name: 'mail', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    search_mail: searchMailTool,
    list_mail_folders: listMailFoldersTool,
    prepare_email: prepareEmailTool,
  },
} satisfies CommandDomain;
