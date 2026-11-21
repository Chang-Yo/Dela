import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

// 日历事件候选色 key，与 --cal-* 设计 token 一一对应；课表的个人事件共用这组颜色。
export const calendarEventColors = [
  'rose',
  'peach',
  'sand',
  'sage',
  'teal',
  'blue',
  'lilac',
  'slate',
] as const;

export type CalendarEventColor = (typeof calendarEventColors)[number];

// 待办只认三种状态（对应 iCalendar 的 NEEDS-ACTION、COMPLETED 与不写），来源的说法放进 statusLabel。
export type TodoStatus = 'open' | 'done' | 'unknown';

const localDay = (value: string) => new Date(`${value}T00:00:00`);
const nextLocalMidnight = (instant: string) => {
  const date = new Date(instant);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};
const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => localDay(value).getDate() === Number(value.slice(8)), '日期不存在');

// 三种时间互斥（ADR 0024）：截止对应 VTODO 的 DUE，时段与全天对应 VEVENT；全天的结束日算在内。
export const todoTimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('due'), at: z.string().datetime() }).strict(),
  z
    .object({ kind: z.literal('span'), start: z.string().datetime(), end: z.string().datetime() })
    .strict()
    .refine(
      ({ start, end }) =>
        Date.parse(end) > Date.parse(start) && Date.parse(end) <= nextLocalMidnight(start),
      '时段的结束须晚于开始且在同一天，跨天请用全天',
    ),
  z
    .object({ kind: z.literal('allDay'), startDate: dateText, endDate: dateText })
    .strict()
    .refine(({ startDate, endDate }) => endDate >= startDate, '结束日期不能早于开始日期'),
]);
export type TodoTime = z.infer<typeof todoTimeSchema>;

/** 待办占据的时间区间（毫秒）。截止类起止同为截止时刻；全天按本地日期，止于结束日的次日零点。 */
export function todoTimeRange(time: TodoTime): [start: number, end: number] {
  if (time.kind === 'due') return [Date.parse(time.at), Date.parse(time.at)];
  if (time.kind === 'span') return [Date.parse(time.start), Date.parse(time.end)];
  const end = localDay(time.endDate);
  end.setDate(end.getDate() + 1);
  return [localDay(time.startDate).getTime(), end.getTime()];
}

export function todoTimeLabel(time: TodoTime | null): string {
  if (!time) return '未设时间';
  const day = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  const clock = (instant: string) =>
    new Date(instant).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (time.kind === 'due') return `截止 ${day(new Date(time.at))} ${clock(time.at)}`;
  if (time.kind === 'span')
    return `${day(new Date(time.start))} ${clock(time.start)}–${clock(time.end)}`;
  const start = day(localDay(time.startDate));
  return time.startDate === time.endDate
    ? `${start} 全天`
    : `${start} – ${day(localDay(time.endDate))} 全天`;
}

/** 与 [startAt, endAt) 有交集；没有时间的待办只在不限范围时入选。 */
export function todoInRange(time: TodoTime | null, startAt?: string, endAt?: string): boolean {
  if (!startAt && !endAt) return true;
  if (!time) return false;
  const [start, end] = todoTimeRange(time);
  return (!startAt || end >= Date.parse(startAt)) && (!endAt || start < Date.parse(endAt));
}
export interface TodoGroup {
  id: string;
  label: string;
}
export interface TodoItem {
  id: string;
  /** 'personal' 或登记来源的 id。 */
  source: string;
  title: string;
  notes: string;
  time: TodoTime | null;
  status: TodoStatus;
  statusLabel?: string;
  completedAt: string | null;
  readAt: string | null;
  createdAt: string;
  color?: CalendarEventColor;
  group?: TodoGroup;
  url?: string;
  bodyHtml?: string;
  syncedAt?: string;
}
export interface TodoSourceState {
  id: string;
  label: string;
  openLabel?: string;
  connected: boolean;
  syncedAt: string | null;
  error: string | null;
}
export interface TodoState {
  items: TodoItem[];
  sources: TodoSourceState[];
  syncing: boolean;
}

export const todoSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).optional(),
    time: todoTimeSchema.nullable().optional(),
    completed: z.boolean().optional(),
    color: z.enum(calendarEventColors).optional(),
  })
  .strict();
export type TodoSaveInput = z.input<typeof todoSaveSchema>;

const todoId = z.string().min(1).max(512);
const state = z.custom<TodoState>();

export const todoContract = defineContract(
  'todo',
  {
    state: { input: z.undefined(), output: state },
    refresh: { input: z.undefined(), output: state },
    save: { input: todoSaveSchema, output: state },
    remove: { input: todoId, output: state },
    markRead: { input: todoId, output: state },
  },
  { state },
);

/** 已连接来源里最早的同步时间，即清单中最旧的数据有多旧；有来源从未同步时为 null。 */
export function todoSyncedAt(state: TodoState): string | null {
  const times = state.sources.filter((source) => source.connected).map((source) => source.syncedAt);
  if (!times.length || times.includes(null)) return null;
  return times.sort()[0]!;
}

export function todoSyncError(state: TodoState): string | null {
  return state.sources.flatMap((source) => source.error ?? []).join('\n') || null;
}

export function todoStatusLabel(item: TodoItem): string {
  return item.statusLabel ?? { open: '未完成', done: '已完成', unknown: '待确认' }[item.status];
}

/** 只有截止类会逾期；时段与全天过去即结束，和已完成一样不再算待办。 */
export function todoOverdue(item: TodoItem, now: number): boolean {
  return item.status !== 'done' && item.time?.kind === 'due' && Date.parse(item.time.at) < now;
}

export function todoFinished(item: TodoItem, now: number): boolean {
  if (item.status === 'done') return true;
  return !!item.time && item.time.kind !== 'due' && todoTimeRange(item.time)[1] <= now;
}

declare module '../../app/module' {
  interface NavTargets {
    todo: { todoId?: string };
  }
}
