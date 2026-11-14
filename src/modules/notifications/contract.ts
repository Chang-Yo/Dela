import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type { NavTarget } from '../../app/module';

export type NotificationCategory = 'like' | 'reply' | 'mention' | 'message' | 'other';

/** 应用内的页面，或交给系统浏览器打开的外部链接。 */
export type NotificationTarget = NavTarget | { url: string };

export interface NotificationItem {
  id: string;
  source: string;
  category: NotificationCategory | null;
  count: number;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  target: NotificationTarget;
  /** 同组的点赞合并成一行展示，例如同一主题下的点赞。 */
  group: string | null;
}

export interface NotificationState {
  items: readonly NotificationItem[];
  totalCount: number;
  unreadCount: number;
  /** 仍在暂停期内时为到期时刻，否则为 null。 */
  snoozedUntil: string | null;
  /** 已登录来源的最近一次刷新结果。 */
  refresh: Record<string, { lastSuccessAt: string | null; error: string | null }>;
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
  },
  {
    state,
    /** 用户点击了系统桌面通知。 */
    open: z.custom<{ id: string; target: NotificationTarget }>(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    notifications: {};
  }
}
