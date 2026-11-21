// 邮件：IMAP/SMTP 通用收发，常用邮箱的服务器预设由其他模块登记；收件箱未读注册为通知来源。
import { defineModule } from '../../app/module';
import { registerCommandDomain } from '../../core/capabilities/commands';
import { registerResourceResolver } from '../../core/capabilities/resources';
import { registerSecretLabel } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { registerSearchProvider } from '../search';
import { registerSettingsSearch } from '../settings';
import { mailContract } from './contract';
import {
  confirmDraftClose,
  downloadAttachment,
  pickComposeAttachments,
  setComposeActive,
} from './main/actions';
import { mailDomain } from './main/agent';
import {
  configureMailAccount,
  deleteMailMessage,
  disconnectMailAccount,
  emptyMailTrash,
  getMailState,
  getMailTrashRetention,
  listMailFolders,
  listMailMessages,
  listMailTrash,
  markMailSeen,
  purgeMailMessage,
  readMailMessage,
  restoreMailMessage,
  sendMessage,
  setMailTrashRetention,
  startMailSync,
} from './main/api';
import { deleteLocalDraft, listLocalDrafts, openEmailDraft, saveLocalDraft } from './main/drafts';
import { registerMailNotices } from './main/notice-source';
import { attachmentResourceResolver, mailResourceResolver } from './main/resources';
import { mailSearch } from './main/search';
import { addComposeImage, releaseComposeFiles } from './main/send';

export { hasMailComposer } from './main/actions';
export { mailAttachment, readMailMessage, saveMailAttachment } from './main/api';
export { openEmailDraft, prepareEmail } from './main/drafts';
export { mailSearch } from './main/search';

// IMAP 沿用增量同步，每五分钟检查一次。
const REFRESH_MS = 5 * 60_000;

function syncInBackground() {
  try {
    if (getMailState().account) startMailSync();
  } catch (error) {
    console.error('Mail background sync failed', error);
  }
}

export const mailModule = defineModule({
  id: 'mail',
  ipc: implement(mailContract, {
    state: getMailState,
    configure: configureMailAccount,
    disconnect: disconnectMailAccount,
    folders: listMailFolders,
    messages: ({ folderId, limit }) => listMailMessages(folderId, limit),
    message: readMailMessage,
    markSeen: markMailSeen,
    deleteMessage: deleteMailMessage,
    restoreMessage: restoreMailMessage,
    purgeMessage: purgeMailMessage,
    emptyTrash: emptyMailTrash,
    trash: listMailTrash,
    trashRetention: getMailTrashRetention,
    setTrashRetention: setMailTrashRetention,
    downloadAttachment,
    pickComposeFiles: pickComposeAttachments,
    addComposeImage,
    releaseComposeFiles,
    send: sendMessage,
    openDraft: openEmailDraft,
    saveDraft: saveLocalDraft,
    drafts: listLocalDrafts,
    deleteDraft: deleteLocalDraft,
    confirmDraftClose,
    setComposeActive,
    sync: startMailSync,
  }),
  register() {
    registerSettingsSearch({
      id: 'mail',
      section: 'connections',
      title: '邮箱',
      keywords: ['连接', '邮箱', '邮件', 'imap', 'smtp', 'mail'],
    });
    registerSettingsSearch({
      id: 'mail-trash-retention',
      section: 'storage',
      title: '已删除邮件保留',
      keywords: ['邮件', '邮箱', '删除', '回收站', '保留', 'trash'],
    });
    registerSecretLabel('mail-credentials', '邮箱凭据');
    registerCommandDomain(mailDomain);
    registerResourceResolver('mail', mailResourceResolver);
    registerResourceResolver('attachment', attachmentResourceResolver);
    registerSearchProvider(mailSearch);
    registerMailNotices();
  },
  start() {
    syncInBackground();
    const timer = setInterval(syncInBackground, REFRESH_MS);
    return () => clearInterval(timer);
  },
});
