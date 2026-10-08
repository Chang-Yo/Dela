import { listMailFoldersTool } from './list-folders';
import { prepareEmailTool } from './prepare-email';
import { searchMailTool } from './search-mail';

export const mailTools = {
  search_mail: searchMailTool,
  list_mail_folders: listMailFoldersTool,
  prepare_email: prepareEmailTool,
};
