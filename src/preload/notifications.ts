import type {
  NotificationFilter,
  NotificationItem,
  NotificationState,
  NotificationsApi,
} from '../shared/api';
import { invoke, on } from './lib';

export const notifications = {
  getJwcNotice: (id: string) => invoke('notifications:jwc-notice', id),
  getJwcCaptcha: (id: string, attachmentId: string) =>
    invoke('notifications:jwc-captcha', id, attachmentId),
  downloadJwcAttachment: (token: string, code: string) =>
    invoke('notifications:jwc-download', token, code),
  getState: (filter?: NotificationFilter) => invoke('notifications:get-state', filter),
  refresh: () => invoke('notifications:refresh'),
  markRead: (id: string) => invoke('notifications:mark-read', id),
  markAllRead: () => invoke('notifications:mark-all-read'),
  setSnooze: (until: string | null) => invoke('notifications:set-snooze', until),
  onUpdate: (listener: (state: NotificationState) => void) =>
    on<NotificationState>('notifications:state', listener),
  onOpen: (listener: (item: NotificationItem) => void) =>
    on<NotificationItem>('notifications:open', listener),
} satisfies NotificationsApi;
