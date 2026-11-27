import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

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

/** 邮箱服务器参数，SSL/TLS 固定开启；常用邮箱的预设由其他模块在界面端登记。 */
export interface MailServerConfig {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly smtpHost: string;
  readonly smtpPort: number;
}

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
  readonly server: MailServerConfig;
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

const result = z.custom<MailResult>();
const messageId = z.number();
const port = z.number().int().min(1).max(65535);
const host = z.string().trim().min(1).max(253);

export const mailContract = defineContract(
  'mail',
  {
    state: { input: z.undefined(), output: z.custom<MailState>() },
    configure: {
      input: z.object({
        address: z.string(),
        password: z.string(),
        server: z.object({ imapHost: host, imapPort: port, smtpHost: host, smtpPort: port }),
      }),
      output: result,
    },
    disconnect: { input: z.undefined(), output: result },
    folders: { input: z.undefined(), output: z.custom<MailFolderInfo[]>() },
    messages: {
      input: z.object({ folderId: z.number(), limit: z.number() }),
      output: z.custom<MailMessageSummary[]>(),
    },
    message: { input: messageId, output: z.custom<MailMessageDetail>() },
    markSeen: { input: messageId, output: result },
    deleteMessage: { input: messageId, output: result },
    restoreMessage: { input: messageId, output: result },
    purgeMessage: { input: messageId, output: result },
    emptyTrash: { input: z.undefined(), output: result },
    trash: { input: z.undefined(), output: z.custom<MailTrashItem[]>() },
    trashRetention: { input: z.undefined(), output: z.custom<MailTrashRetention>() },
    setTrashRetention: {
      input: z.custom<MailTrashRetention>(),
      output: z.custom<MailTrashRetention>(),
    },
    downloadAttachment: {
      input: z.object({ messageId, part: z.string() }),
      output: result,
    },
    pickComposeFiles: {
      input: z.enum(['attachment', 'inline']),
      output: z.custom<MailComposeFile[]>(),
    },
    addComposeImage: { input: z.string(), output: z.custom<MailComposeFile>() },
    releaseComposeFiles: { input: z.array(z.string().uuid()).max(50), output: z.void() },
    send: { input: z.custom<MailSendInput>(), output: result },
    openDraft: { input: z.string(), output: z.custom<PreparedEmail>() },
    saveDraft: { input: z.custom<MailDraftInput>(), output: z.custom<MailDraftSummary>() },
    drafts: { input: z.string(), output: z.custom<MailDraftSummary[]>() },
    deleteDraft: { input: z.string(), output: z.void() },
    preparedSent: { input: z.string(), output: z.boolean() },
    markPreparedSent: { input: z.string(), output: z.void() },
    confirmDraftClose: {
      input: z.undefined(),
      output: z.custom<'save' | 'discard' | 'cancel'>(),
    },
    setComposeActive: { input: z.boolean(), output: z.void() },
    sync: { input: z.undefined(), output: z.void() },
  },
  {
    syncStatus: z.custom<MailSyncStatus>(),
    /** 写信未存时拦下关窗或退出；载荷为是否在退出应用。 */
    requestClose: z.boolean(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    mail: { messageId?: number };
  }
}
