import {
  AtSign,
  BadgeCheck,
  Bell,
  CheckCircle2,
  Edit3,
  Heart,
  Link2,
  Mail,
  MessageSquareQuote,
  Quote,
  Reply,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { ShuiyuanNotificationItem } from '../../../shared/api';

/** 水源站点的头像/资源基地址；renderer 直接引用远程图（CSP 已放行 https）。 */
export const SHUIYUAN_ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
export const SHUIYUAN_HOST = 'shuiyuan.sjtu.edu.cn';

/** 识别 Discourse 的 /t/<id> 与 /t/<slug>/<id>/<post> 站内链接。 */
export function shuiyuanTopicFromUrl(
  value: string,
): { topicId: number; postNumber?: number } | null {
  try {
    const url = new URL(value, SHUIYUAN_ORIGIN);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== SHUIYUAN_HOST ||
      url.username ||
      url.password
    )
      return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 't') return null;
    const idIndex = /^\d+$/.test(parts[1] ?? '') ? 1 : /^\d+$/.test(parts[2] ?? '') ? 2 : -1;
    if (idIndex < 0 || parts.length > idIndex + 2) return null;
    const topicId = Number(parts[idIndex]);
    const postNumber = /^\d+$/.test(parts[idIndex + 1] ?? '')
      ? Number(parts[idIndex + 1])
      : undefined;
    if (!Number.isSafeInteger(topicId) || topicId <= 0) return null;
    if (postNumber !== undefined && (!Number.isSafeInteger(postNumber) || postNumber <= 0))
      return null;
    return postNumber === undefined ? { topicId } : { topicId, postNumber };
  } catch {
    return null;
  }
}

export function avatarUrl(template: string | null, size = 48): string | null {
  if (!template) return null;
  const filled = template.replace('{size}', String(size));
  return filled.startsWith('/') ? `${SHUIYUAN_ORIGIN}${filled}` : filled;
}

/** 列表用相对时间：今天/昨天显示时刻，同年省年份，跨年补年份。 */
export function formatListDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

/** 浏览数等大数的紧凑展示（Discourse 同风格：1.2 万 / 3.4k）。 */
export function formatCount(value: number | null): string {
  if (value === null || value === undefined) return '';
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

/** Discourse 通知类型 → 语义描述；未覆盖的类型给出兜底文案。 */
export function describeNotification(item: ShuiyuanNotificationItem): {
  icon: LucideIcon;
  text: string;
} {
  const who = item.displayUsername ?? '有人';
  const title = item.fancyTitle ? `「${item.fancyTitle}」` : '';
  const typeText: Record<number, { icon: LucideIcon; verb: string }> = {
    1: { icon: Reply, verb: `回复了你在${title}的帖子` },
    2: { icon: AtSign, verb: `在${title}中提到了你` },
    3: { icon: Quote, verb: `在${title}中引用了你的帖子` },
    4: { icon: Edit3, verb: `编辑了你在${title}的帖子` },
    5: { icon: Heart, verb: `赞了你在${title}的帖子` },
    6: { icon: Mail, verb: `给你发来私信${title}` },
    9: { icon: Mail, verb: `给你发来私信${title}` },
    10: { icon: Link2, verb: `在${title}中关联了你的帖子` },
    11: { icon: BadgeCheck, verb: '你获得了新徽章' },
    12: { icon: UserPlus, verb: `邀请你加入${title}` },
    14: { icon: MessageSquareQuote, verb: `在${title}中提及了你所在的群组` },
    18: { icon: Heart, verb: `赞了你在${title}的帖子` },
    19: { icon: CheckCircle2, verb: `你在${title}的帖子已通过审核` },
  };
  const meta = typeText[item.type] ?? { icon: Bell, verb: `与你互动${title}` };
  return { icon: meta.icon, text: `${who} ${meta.verb}` };
}
