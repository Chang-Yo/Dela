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

export type TodoStatus =
  'pending' | 'completed' | 'submitted' | 'graded' | 'excused' | 'resubmit' | 'offline' | 'unknown';
export interface TodoItem {
  id: string;
  source: 'personal' | 'canvas';
  title: string;
  notes: string;
  dueAt: string | null;
  status: TodoStatus;
  readAt: string | null;
  createdAt: string;
  /** 仅个人待办：开启后在日历（周/月视图）中按截止时间显示。 */
  calendar?: boolean;
  /** 仅个人待办：写入日历时的候选色；未选时渲染回退石墨色。 */
  color?: CalendarEventColor;
  courseId?: number;
  /** 课程代码；月历与课表共用它生成稳定的课程颜色。 */
  courseCode?: string;
  courseName?: string;
  assignmentId?: number;
  url?: string;
  /** 作业描述原始 HTML，随同步缓存，renderer 经沙箱 iframe 渲染。 */
  description?: string;
  submittedAt?: string | null;
  syncedAt?: string;
}
export interface TodoState {
  items: TodoItem[];
  /** 已连接外部作业来源（如 Canvas）；未安装或未登录时为 false。 */
  connected: boolean;
  syncing: boolean;
  syncedAt: string | null;
  error: string | null;
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

export const todoStatusLabels: Record<TodoStatus, string> = {
  pending: '未完成',
  completed: '已完成',
  submitted: '已提交',
  graded: '已批改',
  excused: '已豁免',
  resubmit: '需重新提交',
  offline: '线下 / 无需在线提交',
  unknown: '待同步确认',
};

export function todoCompleted(status: TodoStatus): boolean {
  return ['completed', 'submitted', 'graded', 'excused'].includes(status);
}
