export interface WindowState {
  readonly maximized: boolean;
}

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
}

export interface MailAddress {
  readonly name: string | null;
  readonly address: string | null;
}

export interface MailAttachmentInfo {
  readonly filename: string;
  readonly size: number | null;
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
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

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

export type MailResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
}

export interface MailApi {
  openLink(url: string): Promise<void>;
  getState(): Promise<MailState>;
  configure(input: MailConfigureInput): Promise<MailResult>;
  disconnect(): Promise<MailResult>;
  listFolders(): Promise<readonly MailFolderInfo[]>;
  listMessages(folderId: number, limit: number): Promise<readonly MailMessageSummary[]>;
  getMessage(messageId: number): Promise<MailMessageDetail>;
  markSeen(messageId: number): Promise<MailResult>;
  syncNow(): Promise<void>;
  onSyncStatus(listener: (status: MailSyncStatus) => void): () => void;
}

export interface DelaApi {
  readonly version: string;
  readonly window: WindowApi;
  readonly mail: MailApi;
}
