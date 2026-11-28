// 水源页的界面状态；帖子、列表与计数在查询缓存里（use-shuiyuan.ts）。
import { create } from 'zustand';
import type { ShuiyuanFeed, ShuiyuanTopicSummary } from '../contract';

export type ListSelection =
  | ShuiyuanFeed
  | { kind: 'bookmarks' }
  | { kind: 'messages' }
  | { kind: 'notifications' };

export type Reading = { topicId: number; postNumber: number | null };

export type ReplyTarget = { postNumber: number; username: string };

type Draft = { text: string; target: ReplyTarget | null };

/** 已读记录：topicId → 打开该帖时的最后活动时间（ISO）。 */
type ReadMarks = Record<string, string>;

interface ShuiyuanUi {
  list: ListSelection;
  reading: Reading | null;
  /** 经帖内链接一路打开的来路，返回时逐级回到点链接的那一楼；从列表或外部打开时清空。 */
  trail: readonly Reading[];
  readMarks: Readonly<ReadMarks>;
  /** 回复草稿按帖子在本次运行内记忆：返回信息流或切帖后回来仍在。 */
  drafts: Readonly<Record<number, Draft>>;
  /** 已上传附件 upload:// → 站点地址，撰写框据此即时显示真图。 */
  uploads: Readonly<Record<string, string>>;
}

const READ_STORAGE_KEY = 'dela.shuiyuan.read';
const READ_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function loadReadMarks(): ReadMarks {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const cutoff = Date.now() - READ_RETENTION_MS;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && new Date(entry[1]).getTime() > cutoff,
      ),
    );
  } catch {
    return {};
  }
}

export const useShuiyuan = create<ShuiyuanUi>(() => ({
  list: { kind: 'latest' },
  reading: null,
  trail: [],
  readMarks: loadReadMarks(),
  drafts: {},
  uploads: {},
}));

export function markTopicRead(topicId: number, seen: string): void {
  const readMarks = { ...useShuiyuan.getState().readMarks, [topicId]: seen };
  useShuiyuan.setState({ readMarks });
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(readMarks));
  } catch {
    /* 存储不可用时只在本次运行内生效。 */
  }
}

export function isTopicUnread(marks: Readonly<ReadMarks>, topic: ShuiyuanTopicSummary): boolean {
  const seen = marks[topic.id];
  return !seen || (topic.lastPostedAt ?? topic.createdAt) > seen;
}

export function openTopic(topicId: number, postNumber?: number): void {
  useShuiyuan.setState({ reading: { topicId, postNumber: postNumber ?? null }, trail: [] });
}

export function followTopicLink(
  from: Reading,
  topicId: number,
  postNumber: number | undefined,
): void {
  useShuiyuan.setState(({ trail }) => ({
    reading: { topicId, postNumber: postNumber ?? null },
    trail: [...trail, from],
  }));
}

export function leaveTopic(): void {
  useShuiyuan.setState(({ trail }) => ({
    reading: trail.at(-1) ?? null,
    trail: trail.slice(0, -1),
  }));
}

export function draftOf(topicId: number): Draft {
  return useShuiyuan.getState().drafts[topicId] ?? { text: '', target: null };
}

export function saveDraft(topicId: number, change: Partial<Draft>): void {
  const next = { ...draftOf(topicId), ...change };
  const drafts: Record<number, Draft> = { ...useShuiyuan.getState().drafts };
  if (next.text || next.target) drafts[topicId] = next;
  else delete drafts[topicId];
  useShuiyuan.setState({ drafts });
}

export function rememberUpload(shortUrl: string, url: string): void {
  useShuiyuan.setState((state) => ({ uploads: { ...state.uploads, [shortUrl]: url } }));
}
