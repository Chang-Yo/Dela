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

export function avatarUrl(template: string | null, size = 48): string | null {
  if (!template) return null;
  const filled = template.replace('{size}', String(size));
  return filled.startsWith('/') ? `${SHUIYUAN_ORIGIN}${filled}` : filled;
}

/** 列表用相对时间：2 小时内说「n 分钟前」，当天显示时刻，同年省年份，跨年补年份。 */
const RELATIVE_TIME_WINDOW_MS = 2 * 60 * 60 * 1000;

export function formatListDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const age = now.getTime() - date.getTime();
  if (age >= 0 && age < RELATIVE_TIME_WINDOW_MS) {
    const minutes = Math.floor(age / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    return `${Math.floor(minutes / 60)} 小时前`;
  }
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

/** 大数紧凑展示：≥1 万用「万」，其余千分位；全应用统一中文单位，不再用 k。 */
export function formatCount(value: number | null): string {
  if (value === null || value === undefined) return '';
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  return value.toLocaleString('en-US');
}

/** 标签色块：Discourse API 的标签只有名字没有色值，按名称哈希映射固定色相，
 * 同名标签永远同色。饱和度 62%/亮度 52% 取中间调，深浅主题下都可读。 */
export function tagColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 62% 52%)`;
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
