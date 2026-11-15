import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { noticeRuleSchema, type NoticeEntry, type NoticeRule } from './parser';

export const subscriptionStateSchema = z.object({
  version: z.literal(1),
  rule: noticeRuleSchema,
  acquisition: z.enum(['http', 'rendered']).optional(),
  seenIds: z.array(z.string()),
  checkedAt: z.iso.datetime(),
});

export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

export function updateSubscription(
  rule: NoticeRule,
  entries: NoticeEntry[],
  previous: SubscriptionState | null = null,
  checkedAt = new Date().toISOString(),
) {
  if (previous && !isDeepStrictEqual(previous.rule, rule))
    throw new Error('订阅规则已改变，请重新建立基线');
  if (!entries.length) throw new Error('没有有效公告，保留上次订阅状态');
  const seen = new Set(previous?.seenIds);
  const added = new Map<string, NoticeEntry>();
  for (const entry of entries) {
    if (previous && !seen.has(entry.id)) added.set(entry.id, entry);
    seen.add(entry.id);
  }
  return {
    baseline: previous === null,
    newEntries: [...added.values()],
    state: {
      version: 1 as const,
      rule,
      seenIds: [...seen],
      checkedAt,
      ...(previous?.acquisition ? { acquisition: previous.acquisition } : {}),
    },
  };
}
