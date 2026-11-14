export const notificationSources = ['mail', 'shuiyuan', 'todo', 'jwc', 'canvas', 'notice'] as const;
export type NotificationSource = (typeof notificationSources)[number];
export type NotificationCategory = 'like' | 'reply' | 'mention' | 'message' | 'other';
export interface NotificationItem {
  id: string;
  source: NotificationSource;
  category: NotificationCategory | null;
  count: number;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  href:
    | { kind: 'todo'; todoId: string }
    | { kind: 'mail'; messageId: number }
    | { kind: 'jwc'; url: string }
    | { kind: 'notice'; url: string; publishedAt: string | null }
    | { kind: 'canvas'; sourceId: string }
    | { kind: 'shuiyuan'; topicId: number; postNumber?: number | null }
    | { kind: 'shuiyuan-post'; postId: number };
}
export interface NotificationState {
  items: readonly NotificationItem[];
  totalCount: number;
  unreadCount: number;
  snoozedUntil: string | null;
  refresh: Record<
    NotificationSource,
    { lastSuccessAt: string | null; error: string | null } | null
  >;
}
export interface NotificationsApi {
  getJwcNotice(id: string): Promise<JwcNotice>;
  getJwcCaptcha(id: string, attachmentId: string): Promise<{ token: string; image: string }>;
  downloadJwcAttachment(
    token: string,
    code: string,
  ): Promise<{ status: 'saved' | 'canceled' | 'invalid-code' }>;
  getSubscriptions(): Promise<NotificationSubscriptions>;
  setJwcSubscribed(enabled: boolean): Promise<NotificationState>;
  previewNoticeSubscription(
    url: string,
    sampleTitle?: string,
    render?: boolean,
  ): Promise<NoticePreview>;
  addNoticeSubscription(token: string, candidate: number): Promise<NotificationState>;
  removeNoticeSubscription(id: string): Promise<NotificationState>;
  getState(sources?: readonly NotificationSource[]): Promise<NotificationState>;
  refresh(): Promise<NotificationState>;
  markRead(id: string): Promise<NotificationState>;
  markAllRead(sources?: readonly NotificationSource[]): Promise<NotificationState>;
  setSnooze(until: string | null): Promise<NotificationState>;
  onUpdate(listener: (state: NotificationState) => void): () => void;
  onOpen(listener: (item: NotificationItem) => void): () => void;
}

export interface NoticeSubscription {
  id: string;
  label: string;
  pageUrl: string;
  acquisition: 'http' | 'rendered';
  lastSuccessAt: string | null;
  error: string | null;
}

export interface NotificationSubscriptions {
  jwc: boolean;
  notices: NoticeSubscription[];
}

export interface NoticePreview {
  token: string;
  pageUrl: string;
  title: string;
  acquisition: 'http' | 'rendered';
  status: 'ok' | 'needs-selection' | 'unsupported';
  candidates: {
    label: string;
    reasons: string[];
    entries: { title: string; url: string; publishedAt: string | null }[];
  }[];
  feeds: { title: string; url: string }[];
  diagnostics: string[];
}

export interface JwcNotice {
  id: string;
  title: string;
  publishedAt: string;
  url: string;
  html: string;
  attachments: { id: string; name: string; url: string }[];
}
