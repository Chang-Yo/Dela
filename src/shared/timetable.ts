export interface TimetableLesson {
  readonly id: number;
  readonly semester: string;
  readonly courseCode: string;
  readonly courseName: string;
  readonly className: string | null;
  readonly teacher: string | null;
  readonly campus: string | null;
  readonly classroom: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly endPeriod: number;
  readonly periodsText: string;
  readonly weeksText: string;
  readonly weekNumbers: readonly number[];
  readonly credits: number | null;
  readonly note: string | null;
}

export interface TimetableState {
  readonly semester: string;
  readonly lastSyncedAt: string | null;
  readonly semesterStart: string | null;
}

// 日历事件候选色 key，与 renderer 的 --cal-* 设计 token 一一对应。
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

export interface CalendarEvent {
  /** 自建事件为数据库自增 id；来自个人待办的派生事件是 `todo:{todoId}` 字符串。 */
  readonly id: number | string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string | null;
  readonly color: CalendarEventColor | null;
  /** 非空表示这条事件由个人待办派生，值为待办 id；删除须走待办而非日历。 */
  readonly todoId?: string;
}

export interface CalendarEventInput {
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly location?: string;
  readonly color?: CalendarEventColor;
}

export interface TimetableResult {
  readonly ok: boolean;
  readonly error?: string;
  /** 非空表示失败原因是登录失效，界面据此引导重新登录而非当作普通失败。 */
  readonly reason?: 'auth';
}

export interface TimetableApi {
  getState(semester?: string): Promise<TimetableState>;
  connect(): Promise<TimetableResult>;
  disconnect(): Promise<TimetableResult>;
  listLessons(semester?: string): Promise<readonly TimetableLesson[]>;
  listEvents(startAt: string, endAt: string): Promise<readonly CalendarEvent[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  deleteEvent(id: number): Promise<void>;
  setSemesterStart(semester: string, value: string): Promise<void>;
  syncNow(semester?: string): Promise<TimetableResult>;
}
