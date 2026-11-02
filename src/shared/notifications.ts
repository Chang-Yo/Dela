export type NotificationSource = 'mail' | 'shuiyuan' | 'todo' | 'jwc';
export type NotificationFilter = 'all' | NotificationSource;
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
    | { kind: 'shuiyuan'; topicId: number; postNumber?: number | null };
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
  getState(filter?: NotificationFilter): Promise<NotificationState>;
  refresh(): Promise<NotificationState>;
  markRead(id: string): Promise<NotificationState>;
  markAllRead(): Promise<NotificationState>;
  setSnooze(until: string | null): Promise<NotificationState>;
  onUpdate(listener: (state: NotificationState) => void): () => void;
  onOpen(listener: (item: NotificationItem) => void): () => void;
}

export interface JwcNotice {
  id: string;
  title: string;
  publishedAt: string;
  url: string;
  html: string;
  attachments: { id: string; name: string; url: string }[];
}
