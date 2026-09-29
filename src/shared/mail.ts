export interface MailAddress {
  readonly name: string | null;
  readonly address: string | null;
}

export interface MailAttachmentInfo {
  readonly filename: string;
  readonly size: number | null;
  readonly part: string | null;
}

export interface MailFolderInfo {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly total: number | null;
  readonly unread: number | null;
  readonly lastSyncedAt: string | null;
}

export interface MailMessageSummary {
  readonly id: number;
  readonly uid: number;
  readonly subject: string | null;
  readonly sender: MailAddress | null;
  readonly date: string | null;
  readonly seen: boolean;
  readonly flagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string | null;
  readonly size: number | null;
}

export interface MailMessageDetail extends MailMessageSummary {
  readonly folderId?: number;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

/** 回收站条目：本地删除的缓存邮件，附原文件夹名与删除时间。 */
export interface MailTrashItem extends MailMessageSummary {
  readonly folderName: string | null;
  readonly deletedAt: string;
}

/** 本地回收站保留天数；0 表示永久保留。 */
export type MailTrashRetention = 7 | 30 | 90 | 0;

export type MailSyncPhase = 'idle' | 'connecting' | 'syncing' | 'error';

export interface MailSyncStatus {
  readonly phase: MailSyncPhase;
  readonly folderPath: string | null;
  readonly processed: number;
  readonly total: number | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface MailAccountInfo {
  readonly address: string;
  readonly lastSyncedAt: string | null;
}

export interface MailState {
  readonly account: MailAccountInfo | null;
  readonly sync: MailSyncStatus;
}

export type MailResult =
  { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
}

export type MailComposeFileKind = 'attachment' | 'inline';

export interface MailComposeFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: MailComposeFileKind;
  readonly previewUrl: string | null;
}

export interface PreparedEmail {
  id: string;
  to: string[];
  subject: string;
  text: string;
  files: MailComposeFile[];
  html?: string;
  savedLocally?: boolean;
  recipientText?: string;
}

export interface MailDraftInput {
  id?: string;
  account: string;
  recipientText: string;
  subject: string;
  text: string;
  html: string;
  attachmentIds: string[];
  inlineImageIds: string[];
}

export interface MailDraftSummary {
  id: string;
  subject: string;
  recipientText: string;
  updatedAt: string;
}

export interface MailSendInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attachmentIds: readonly string[];
  readonly inlineImageIds: readonly string[];
}

export interface MailApi {
  getState(): Promise<MailState>;
  configure(input: MailConfigureInput): Promise<MailResult>;
  disconnect(): Promise<MailResult>;
  listFolders(): Promise<readonly MailFolderInfo[]>;
  listMessages(folderId: number, limit: number): Promise<readonly MailMessageSummary[]>;
  getMessage(messageId: number): Promise<MailMessageDetail>;
  markSeen(messageId: number): Promise<MailResult>;
  deleteMessage(messageId: number): Promise<MailResult>;
  restoreMessage(messageId: number): Promise<MailResult>;
  purgeMessage(messageId: number): Promise<MailResult>;
  emptyTrash(): Promise<MailResult>;
  listTrash(): Promise<readonly MailTrashItem[]>;
  getTrashRetention(): Promise<MailTrashRetention>;
  setTrashRetention(retention: MailTrashRetention): Promise<MailTrashRetention>;
  downloadAttachment(messageId: number, part: string): Promise<MailResult>;
  pickComposeFiles(kind: MailComposeFileKind): Promise<readonly MailComposeFile[]>;
  addComposeImage(dataUrl: string): Promise<MailComposeFile>;
  releaseComposeFiles(ids: readonly string[]): Promise<void>;
  sendMessage(input: MailSendInput): Promise<MailResult>;
  openDraft(id: string): Promise<PreparedEmail>;
  saveDraft(input: MailDraftInput): Promise<MailDraftSummary>;
  listDrafts(account: string): Promise<MailDraftSummary[]>;
  deleteDraft(id: string): Promise<void>;
  confirmDraftClose(): Promise<'save' | 'discard' | 'cancel'>;
  setComposeActive(active: boolean): Promise<void>;
  onRequestClose(listener: () => void): () => void;
  syncNow(): Promise<void>;
  onSyncStatus(listener: (status: MailSyncStatus) => void): () => void;
}
