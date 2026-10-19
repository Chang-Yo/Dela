import type { WebContents } from 'electron';
import { z } from 'zod';
import {
  calendarEventColors,
  type CalendarEvent,
  type TimetableLesson,
  type TimetableResult,
  type TimetableState,
} from '../../shared/api';
import { getDatabase } from '../database';
import { lessonOccurrences } from '../../shared/schedule';
import {
  campusRequest,
  flushCampusSession,
  getCampusSession,
  openCampusLoginWindow,
} from '../campus';

const CAMPUS_ORIGIN = 'https://i.sjtu.edu.cn';
const LOGIN_URL = `${CAMPUS_ORIGIN}/jaccountlogin`;
const TIMETABLE_URL = `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

const rawLessonSchema = z
  .object({
    cdmc: z.string().optional(),
    jc: z.string().optional(),
    jcs: z.string().optional(),
    jxb_id: z.string().optional(),
    jxbmc: z.string().optional(),
    kch: z.string().optional(),
    kch_id: z.string().optional(),
    kcmc: z.string().optional(),
    xf: z.string().optional(),
    xkbz: z.string().optional(),
    xm: z.string().optional(),
    xqj: z.string().optional(),
    xqmc: z.string().optional(),
    zcd: z.string().optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    kbList: z.array(rawLessonSchema),
    rqazcList: z.array(z.unknown()).optional(),
  })
  .passthrough();
const semesterSchema = z.string().regex(/^\d{4}-\d{4}-[123]$/);
const dateTimeSchema = z.string().datetime();
const calendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startAt: dateTimeSchema,
    endAt: dateTimeSchema,
    location: z.string().trim().max(120).optional(),
    color: z.enum(calendarEventColors).optional(),
  })
  .refine(
    (event) => new Date(event.endAt).getTime() > new Date(event.startAt).getTime(),
    '结束时间必须晚于开始时间',
  );

type LessonRow = {
  id: number;
  semester: string;
  course_code: string;
  course_name: string;
  class_name: string | null;
  teacher: string | null;
  campus: string | null;
  classroom: string | null;
  weekday: number;
  start_period: number;
  end_period: number;
  periods_text: string;
  weeks_text: string;
  week_numbers: string;
  credits: number | null;
  note: string | null;
};

type CalendarEventRow = {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  color: string | null;
};

function mapEvent(row: CalendarEventRow): CalendarEvent {
  const stored = row.color;
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    // 旧缓存或异常值回退为无色，渲染时按中性色处理。
    color:
      stored && (calendarEventColors as readonly string[]).includes(stored)
        ? (stored as CalendarEvent['color'])
        : null,
  };
}

export function parseSemesterStart(values: readonly unknown[] | undefined): string | null {
  const dates = (values ?? [])
    .flatMap((value) => {
      const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
      return text.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g) ?? [];
    })
    .map((value) => {
      const [year, month, day] = value.split(/[-/.]/).map(Number);
      if (!year || !month || !day) return null;
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
        return null;
      return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
        .toString()
        .padStart(2, '0')}`;
    })
    .filter((value): value is string => value !== null)
    .sort();
  return dates[0] ?? null;
}

export function currentSemester(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 9) return `${year}-${year + 1}-1`;
  if (month <= 2) return `${year - 1}-${year}-1`;
  if (month <= 7) return `${year - 1}-${year}-2`;
  return `${year - 1}-${year}-3`;
}

export function resolveSemester(requested: unknown): string {
  return requested === undefined ? currentSemester() : semesterSchema.parse(requested);
}

function syncRow(
  semester: string,
): { last_synced_at: string; semester_start: string | null } | undefined {
  return getDatabase()
    .prepare('SELECT last_synced_at, semester_start FROM timetable_sync WHERE semester = ?')
    .get(semester) as { last_synced_at: string; semester_start: string | null } | undefined;
}

function semesterParams(semester: string): { xnm: string; xqm: string } {
  const parsed = semesterSchema.safeParse(semester);
  if (!parsed.success) throw new Error('学期格式无效');
  const [year, , term] = parsed.data.split('-');
  const termCodes: Record<string, string> = { '1': '3', '2': '12', '3': '16' };
  return { xnm: year!, xqm: termCodes[term!]! };
}

function parsePeriods(value: string | undefined): { start: number; end: number; text: string } {
  const numbers = (value ?? '').match(/\d+/g)?.map(Number) ?? [];
  const start = numbers[0] ?? 1;
  const end = numbers.at(-1) ?? start;
  return {
    start: Math.min(20, Math.max(1, start)),
    end: Math.min(20, Math.max(start, end)),
    text: value?.trim() || `${start}-${end}节`,
  };
}

export function parseWeekNumbers(value: string | undefined): number[] {
  if (!value) return [];
  const odd = /单/.test(value);
  const even = /双/.test(value);
  const result = new Set<number>();
  for (const part of value.replace(/[周()（）单双]/g, '').split(/[,，、]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 0) continue;
    const start = numbers[0]!;
    const end = numbers[1] ?? start;
    for (let week = start; week <= end && week <= 30; week += 1) {
      if ((odd && week % 2 === 0) || (even && week % 2 === 1)) continue;
      result.add(week);
    }
  }
  return [...result].sort((a, b) => a - b);
}

function mapRow(row: LessonRow): TimetableLesson {
  let weekNumbers: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.week_numbers);
    if (Array.isArray(parsed))
      weekNumbers = parsed.filter((week): week is number => Number.isInteger(week));
  } catch {
    // Keep the cached lesson visible even if a future schema changes the stored value.
  }
  return {
    id: row.id,
    semester: row.semester,
    courseCode: row.course_code,
    courseName: row.course_name,
    className: row.class_name,
    teacher: row.teacher,
    campus: row.campus,
    classroom: row.classroom,
    weekday: row.weekday,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    periodsText: row.periods_text,
    weeksText: row.weeks_text,
    weekNumbers,
    credits: row.credits,
    note: row.note,
  };
}

export async function isConnected(): Promise<boolean> {
  const campus = await getCampusSession();
  if ((await campus.cookies.get({ url: CAMPUS_ORIGIN })).length === 0) return false;
  try {
    await fetchTimetable(currentSemester());
    return true;
  } catch {
    return false;
  }
}

export function openLoginWindow(sender: WebContents): Promise<TimetableResult> {
  return openCampusLoginWindow({
    sender,
    title: '登录教学信息服务网',
    url: LOGIN_URL,
    reached: (url) =>
      (url.startsWith('https://i.sjtu.edu.cn/') || url.startsWith('http://i.sjtu.edu.cn/')) &&
      !url.includes('/jaccountlogin'),
    probe: async () => {
      await fetchTimetable(currentSemester());
      await flushCampusSession();
    },
  });
}

async function fetchTimetable(semester: string) {
  const { xnm, xqm } = semesterParams(semester);
  const body = new URLSearchParams({ xnm, xqm, kzlx: 'ck', xsdm: '' });
  const text = await campusRequest(await getCampusSession(), TIMETABLE_URL, {
    service: '课表',
    loginError: '登录已失效，请重新登录',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${CAMPUS_ORIGIN}/kbcx/xskbcx_cxXsgrkbIndex.html?gnmkdm=N2151`,
    },
    body: body.toString(),
  });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('课表接口没有返回预期的数据，请重新登录后再试');
  }
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new Error('课表返回了无法识别的数据');
  return parsed.data;
}

export async function syncTimetable(semester: string): Promise<TimetableResult> {
  try {
    const data = await fetchTimetable(semester);
    await flushCampusSession();

    const semesterStart = parseSemesterStart(data.rqazcList);
    const lessons = data.kbList.flatMap((raw, index) => {
      const courseName = raw.kcmc?.trim();
      const weekday = Number(raw.xqj);
      if (!courseName || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return [];
      const periods = parsePeriods(raw.jcs || raw.jc);
      const weeksText = raw.zcd?.trim() || '周次未提供';
      const credits = raw.xf ? Number(raw.xf) : null;
      return [
        {
          semester,
          sourceId: raw.jxb_id || raw.kch_id || `${raw.kch ?? courseName}-${index}`,
          courseCode: raw.kch?.trim() || '',
          courseName,
          className: raw.jxbmc?.trim() || null,
          teacher: raw.xm?.trim() || null,
          campus: raw.xqmc?.trim() || null,
          classroom: raw.cdmc?.trim() || null,
          weekday,
          startPeriod: periods.start,
          endPeriod: periods.end,
          periodsText: raw.jc?.trim() || periods.text,
          weeksText,
          weekNumbers: JSON.stringify(parseWeekNumbers(raw.zcd)),
          credits: Number.isFinite(credits) ? credits : null,
          note: raw.xkbz?.trim() || null,
        },
      ];
    });

    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO timetable_lessons
       (semester, source_id, course_code, course_name, class_name, teacher, campus, classroom,
        weekday, start_period, end_period, periods_text, weeks_text, week_numbers, credits, note)
       VALUES (@semester, @sourceId, @courseCode, @courseName, @className, @teacher, @campus,
        @classroom, @weekday, @startPeriod, @endPeriod, @periodsText, @weeksText, @weekNumbers,
        @credits, @note)`,
    );
    const syncedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM timetable_lessons WHERE semester = ?').run(semester);
      for (const lesson of lessons) insert.run(lesson);
      db.prepare(
        `INSERT INTO timetable_sync (semester, last_synced_at, semester_start) VALUES (?, ?, ?)
         ON CONFLICT(semester) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           semester_start = COALESCE(excluded.semester_start, timetable_sync.semester_start)`,
      ).run(semester, syncedAt, semesterStart);
    })();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function listLessons(semester: string): TimetableLesson[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM timetable_lessons WHERE semester = ?
       ORDER BY weekday, start_period, course_name`,
    )
    .all(semester) as LessonRow[];
  return rows.map(mapRow);
}

export const scheduleQuerySchema = z
  .object({
    semester: semesterSchema.optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.endAt) > Date.parse(value.startAt) &&
      Date.parse(value.endAt) - Date.parse(value.startAt) <= 366 * 86400000,
    '查询范围必须为正数且不超过一年',
  );

export function querySchedule(input: unknown) {
  const args = scheduleQuerySchema.parse(input);
  const semester = args.semester ?? currentSemester();
  const row = syncRow(semester);
  const courses = lessonOccurrences(
    listLessons(semester),
    row?.semester_start ?? null,
    args.startAt,
    args.endAt,
  );
  const events = listCalendarEvents(args.startAt, args.endAt).map((event) => ({
    ...event,
    source: 'event' as const,
  }));
  const warnings = [...courses.warnings];
  if (!row?.last_synced_at) warnings.push('该学期课表尚未同步');
  return {
    semester,
    timezone: 'Asia/Shanghai',
    items: [...courses.items, ...events].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    coverage: {
      courseSyncedAt: row?.last_synced_at || null,
      complete: warnings.length === 0,
      warnings,
    },
  };
}

export function listCalendarEvents(startValue: unknown, endValue: unknown) {
  const startAt = dateTimeSchema.parse(startValue);
  const endAt = dateTimeSchema.parse(endValue);
  return (
    getDatabase()
      .prepare(
        `SELECT id, title, start_at, end_at, location, color FROM calendar_events
         WHERE end_at > ? AND start_at < ? ORDER BY start_at`,
      )
      .all(startAt, endAt) as CalendarEventRow[]
  ).map(mapEvent);
}

export function createCalendarEvent(input: unknown) {
  const event = calendarEventSchema.parse(input);
  const result = getDatabase()
    .prepare(
      `INSERT INTO calendar_events (title, start_at, end_at, location, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.title,
      event.startAt,
      event.endAt,
      event.location || null,
      event.color || null,
      new Date().toISOString(),
    );
  return mapEvent({
    id: Number(result.lastInsertRowid),
    title: event.title,
    start_at: event.startAt,
    end_at: event.endAt,
    location: event.location || null,
    color: event.color || null,
  });
}

export function deleteCalendarEvent(id: unknown) {
  // 只删自建事件；课程在 timetable_lessons 表，不经此入口。
  const eventId = z.number().int().positive().parse(id);
  getDatabase().prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
}

/** calendar_events 表只读视图；不存在返回 null。 */
export function getCalendarEvent(idInput: unknown): CalendarEvent | null {
  const id = z.number().int().positive().parse(idInput);
  const row = getDatabase()
    .prepare(
      'SELECT id, title, start_at, end_at, location, color FROM calendar_events WHERE id = ?',
    )
    .get(id) as CalendarEventRow | undefined;
  return row ? mapEvent(row) : null;
}

/** 已同步学期状态（timetable_sync 表只读视图；手动补设学期日期会产生 last_synced_at 为空的行）。 */
export interface SemesterSyncStatus {
  readonly semester: string;
  readonly lastSyncedAt: string | null;
  readonly semesterStart: string | null;
}

export function listSyncedSemesters(): SemesterSyncStatus[] {
  const rows = getDatabase()
    .prepare(
      'SELECT semester, last_synced_at, semester_start FROM timetable_sync ORDER BY semester',
    )
    .all() as { semester: string; last_synced_at: string; semester_start: string | null }[];
  return rows.map((row) => ({
    semester: row.semester,
    lastSyncedAt: row.last_synced_at || null,
    semesterStart: row.semester_start,
  }));
}

/** 按本地时钟推断当前学期并显式给出推断依据（系统时间错误会让推断出错）。 */
export function currentSemesterInfo(now = new Date()): { semester: string; basis: string } {
  const semester = currentSemester(now);
  const month = now.getMonth() + 1;
  const label =
    month >= 9
      ? '9 月及以后属第一学期'
      : month <= 2
        ? '1–2 月仍属上一学年第一学期'
        : month <= 7
          ? '3–7 月属第二学期'
          : '8 月属第三学期（暑期）';
  const date = `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { semester, basis: `按本机时钟 ${date} 推断：${label}` };
}

export async function getTimetableState(requested?: unknown): Promise<TimetableState> {
  const semester = resolveSemester(requested);
  const row = syncRow(semester);
  return {
    connected: await isConnected(),
    semester,
    lastSyncedAt: row?.last_synced_at || null,
    semesterStart: row?.semester_start ?? null,
  };
}

export function setSemesterStart(requested: unknown, value: unknown) {
  const semester = semesterSchema.parse(requested);
  // 手动补设学期日期时可能还没有同步记录，先落到空串以满足 NOT NULL。
  getDatabase()
    .prepare(
      `INSERT INTO timetable_sync (semester, last_synced_at, semester_start) VALUES (?, '', ?)
       ON CONFLICT(semester) DO UPDATE SET semester_start = excluded.semester_start`,
    )
    .run(
      semester,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(value),
    );
}
