export type NotificationSource = 'mail' | 'shuiyuan' | 'todo';
export type NotificationFilter = 'all' | NotificationSource;
export interface NotificationItem {
  id: string;
  source: NotificationSource;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  href:
    | { kind: 'todo'; todoId: string }
    | { kind: 'mail'; messageId: number }
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
  getState(filter?: NotificationFilter): Promise<NotificationState>;
  refresh(): Promise<NotificationState>;
  markRead(id: string): Promise<NotificationState>;
  markAllRead(): Promise<NotificationState>;
  setSnooze(until: string | null): Promise<NotificationState>;
  onUpdate(listener: (state: NotificationState) => void): () => void;
  onOpen(listener: (item: NotificationItem) => void): () => void;
}
