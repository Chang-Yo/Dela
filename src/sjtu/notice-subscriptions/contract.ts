import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import type { NotificationState } from '../../modules/notifications/contract';

export const WEBSITE_NOTICE_SOURCE = 'notice';
export const WEBSITE_SUBSCRIPTIONS_SETTING = 'experimental-notice-subscriptions';

export interface NoticeSubscription {
  id: string;
  label: string;
  pageUrl: string;
  acquisition: 'http' | 'rendered';
  lastSuccessAt: string | null;
  entryCount: number;
  unreadCount: number;
  error: string | null;
}

export interface WebsiteSubscriptions {
  experimental: boolean;
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
  sectionLinks?: { title: string; url: string }[];
  diagnostics: string[];
}

const state = z.custom<NotificationState>();

export const websiteSubscriptionsContract = defineContract('websiteSubscriptions', {
  subscriptions: { input: z.undefined(), output: z.custom<WebsiteSubscriptions>() },
  setNoticeSubscriptionsEnabled: { input: z.boolean(), output: state },
  previewNoticeSubscription: {
    input: z.object({
      url: z.string().trim().min(1).max(2000),
      sampleTitle: z.string().trim().max(500).optional(),
      render: z.boolean().optional(),
    }),
    output: z.custom<NoticePreview>(),
  },
  addNoticeSubscription: {
    input: z.object({ token: z.string().uuid(), candidate: z.number().int().min(0) }),
    output: state,
  },
  removeNoticeSubscription: { input: z.string().min(1).max(200), output: state },
});
