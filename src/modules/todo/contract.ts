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
  dueAt: string | null;
  status: TodoStatus;
  statusLabel?: string;
  completedAt: string | null;
  readAt: string | null;
  createdAt: string;
  calendar?: boolean;
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
    dueAt: z.string().datetime().nullable().optional(),
    completed: z.boolean().optional(),
    calendar: z.boolean().optional(),
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

declare module '../../app/module' {
  interface NavTargets {
    todo: { todoId?: string };
  }
}
