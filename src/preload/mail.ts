import type {
  MailApi,
  MailComposeFileKind,
  MailConfigureInput,
  MailDraftInput,
  MailSendInput,
  MailSyncStatus,
  MailTrashRetention,
} from '../shared/api';
import { invoke, on } from './lib';

export const mail = {
  getState: () => invoke('mail:get-state'),
  configure: (input: MailConfigureInput) => invoke('mail:configure', input),
  disconnect: () => invoke('mail:disconnect'),
  listFolders: () => invoke('mail:list-folders'),
  listMessages: (folderId: number, limit: number) => invoke('mail:list-messages', folderId, limit),
  getMessage: (messageId: number) => invoke('mail:get-message', messageId),
  markSeen: (messageId: number) => invoke('mail:mark-seen', messageId),
  deleteMessage: (messageId: number) => invoke('mail:delete-message', messageId),
  restoreMessage: (messageId: number) => invoke('mail:restore-message', messageId),
  purgeMessage: (messageId: number) => invoke('mail:purge-message', messageId),
  emptyTrash: () => invoke('mail:empty-trash'),
  listTrash: () => invoke('mail:list-trash'),
  getTrashRetention: () => invoke('mail:get-trash-retention'),
  setTrashRetention: (retention: MailTrashRetention) =>
    invoke('mail:set-trash-retention', retention),
  downloadAttachment: (messageId: number, part: string) =>
    invoke('mail:download-attachment', messageId, part),
  pickComposeFiles: (kind: MailComposeFileKind) => invoke('mail:pick-compose-files', kind),
  addComposeImage: (dataUrl: string) => invoke('mail:add-compose-image', dataUrl),
  releaseComposeFiles: (ids: readonly string[]) => invoke('mail:release-compose-files', ids),
  sendMessage: (input: MailSendInput) => invoke('mail:send-message', input),
  openDraft: (id: string) => invoke('workspace:open-email-draft', id),
  saveDraft: (input: MailDraftInput) => invoke('mail:save-draft', input),
  listDrafts: (account: string) => invoke('mail:list-drafts', account),
  deleteDraft: (id: string) => invoke('mail:delete-draft', id),
  confirmDraftClose: () => invoke('mail:confirm-draft-close'),
  setComposeActive: (active: boolean) => invoke('mail:compose-active', active),
  onRequestClose: (listener: (quitting: boolean) => void) => on('mail:request-close', listener),
  syncNow: () => invoke('mail:sync'),
  onSyncStatus: (listener: (status: MailSyncStatus) => void) =>
    on<MailSyncStatus>('mail:sync-status', listener),
} satisfies MailApi;
