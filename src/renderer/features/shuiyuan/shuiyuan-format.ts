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
import type { ShuiyuanNotificationItem, ShuiyuanUpload } from '../../../shared/api';
import { formatSize } from '../mail/mail-format';

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
  const typeText: Record<number, { icon: LucideIcon; text: string }> = {
    1: { icon: AtSign, text: `${who} 在${title}中提到了你` },
    2: { icon: Reply, text: `${who} 回复了你在${title}的帖子` },
    3: { icon: Quote, text: `${who} 在${title}中引用了你的帖子` },
    4: { icon: Edit3, text: `${who} 编辑了你在${title}的帖子` },
    5: { icon: Heart, text: `${who} 赞了你在${title}的帖子` },
    6: { icon: Mail, text: `${who} 给你发来私信${title}` },
    7: { icon: UserPlus, text: `${who} 邀请你加入私信${title}` },
    9: { icon: Reply, text: `${who} 在你关注的${title}中发布了新帖子` },
    11: { icon: Link2, text: `${who} 在${title}中链接了你的帖子` },
    12: { icon: BadgeCheck, text: '你获得了新徽章' },
    13: { icon: UserPlus, text: `${who} 邀请你参与${title}` },
    15: { icon: MessageSquareQuote, text: `${who} 在${title}中提及了你所在的群组` },
    19: { icon: Heart, text: `${who} 赞了你的 ${item.count} 个帖子` },
    20: { icon: CheckCircle2, text: `你在${title}的帖子已通过审核` },
  };
  return typeText[item.type] ?? { icon: Bell, text: `${who} 与你互动${title}` };
}

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** 与水源网页端编辑器一致的附件写法，站点据此生成灯箱、播放器与附件卡片。 */
export function uploadMarkdown(
  file: { name: string; type: string; size: number },
  upload: ShuiyuanUpload,
): string {
  const name = (upload.originalFilename ?? file.name).replace(/[[\]|\n]/g, ' ');
  const kind = file.type.split('/')[0];
  if (kind === 'video' || kind === 'audio') return `![${name}|${kind}](${upload.shortUrl})`;
  if (kind === 'image' || IMAGE_NAME.test(name)) {
    const size = upload.width && upload.height ? `|${upload.width}x${upload.height}` : '';
    return `![${name.replace(/\.\w+$/, '')}${size}](${upload.shortUrl})`;
  }
  return `[${name}|attachment](${upload.shortUrl}) (${formatSize(file.size)})`;
}
