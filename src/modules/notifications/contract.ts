import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type { NavTarget } from '../../app/module';

export type NotificationCategory = 'like' | 'reply' | 'mention' | 'message' | 'other';

export type NotificationTarget = NavTarget | { url: string };

export interface NotificationItem {
  id: string;
  source: string;
  category: NotificationCategory | null;
  count: number;
  title: string;
  body: string;
  createdAt: string;
  publishedAt?: string | null;
  readAt: string | null;
  target: NotificationTarget;
  group: string | null;
}

export interface NotificationState {
  items: readonly NotificationItem[];
  totalCount: number;
  unreadCount: number;
  /** 仍在暂停期内时为到期时刻，否则为 null。 */
  snoozedUntil: string | null;
  refresh: Record<string, { lastSuccessAt: string | null; error: string | null }>;
}

export interface BuiltInSubscription {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
}

const state = z.custom<NotificationState>();
const sources = z.array(z.string().min(1).max(40)).min(1).optional();

export const notificationsContract = defineContract(
  'notifications',
  {
    state: { input: sources, output: state },
    refresh: { input: z.undefined(), output: state },
    markRead: { input: z.string().min(1).max(1000), output: state },
    markAllRead: { input: sources, output: state },
    setSnooze: { input: z.string().datetime().nullable(), output: state },
    subscriptions: { input: z.undefined(), output: z.custom<BuiltInSubscription[]>() },
    setBuiltInSubscription: {
      input: z.object({ id: z.string().min(1).max(40), enabled: z.boolean() }),
      output: state,
    },
    /** 新消息的系统提醒开关；关闭只停桌面通知，应用内列表不受影响。 */
    messageAlerts: { input: z.undefined(), output: z.boolean() },
    setMessageAlerts: { input: z.boolean(), output: z.boolean() },
  },
  {
    state,
    open: z.custom<{ id: string; target: NotificationTarget }>(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    notifications: {};
  }
}
