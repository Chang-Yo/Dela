import { z } from 'zod';
import { campusRequest, getCampusSession } from '../campus';

export const GRADUATE_CAMPUS_ORIGIN = 'https://yjs.sjtu.edu.cn';
export const GRADUATE_LOGIN_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/*default/index.do?THEME=purple&EMAP_LANG=zh#/xskcb`;

const SCHEDULE_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/modules/xskcb/xspkjgcx.do`;
const COURSES_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/modules/xskcb/xsjxrwcx.do`;

const scheduleRowSchema = z
  .object({
    BJDM: z.string(),
    BJMC: z.string().nullable(),
    JASMC: z.string().nullable(),
    JSJCDM: z.number().int().min(1).max(20),
    JSXM: z.string().nullable(),
    KBBZ: z.string().nullable(),
    KCDM: z.string(),
    KCMC: z.string(),
    KSJCDM: z.number().int().min(1).max(20),
    WID: z.string(),
    XQ: z.number().int().min(1).max(7),
    ZCBH: z.string().regex(/^[01]+$/),
    ZCMC: z.string(),
  })
  .passthrough();

const courseRowSchema = z
  .object({
    BJDM: z.string(),
    BJMC: z.string().nullable(),
    KCDM: z.string(),
    KCMC: z.string(),
    RKJS: z.string().nullable(),
    SCSKRQ: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    XKBZ: z.string().nullable(),
    XQDM_DISPLAY: z.string().nullable(),
  })
  .passthrough();

const scheduleResponseSchema = z.object({
  code: z.literal('0'),
  datas: z.object({ xspkjgcx: z.object({ rows: z.array(scheduleRowSchema) }) }),
});

const courseResponseSchema = z.object({
  code: z.literal('0'),
  datas: z.object({ xsjxrwcx: z.object({ rows: z.array(courseRowSchema) }) }),
});

export type GraduateScheduleRow = z.infer<typeof scheduleRowSchema>;
export type GraduateCourseRow = z.infer<typeof courseRowSchema>;

function semesterCode(semester: string): string {
  const match = /^(\d{4})-(\d{4})-([123])$/.exec(semester);
  if (!match) throw new Error('学期格式无效');
  const suffix = { '1': '09', '2': '02', '3': '06' }[match[3]!]!;
  return `${match[3] === '1' ? match[1] : match[2]}${suffix}`;
}

function weekNumbers(mask: string): number[] {
  return [...mask].flatMap((value, index) => (value === '1' ? [index + 1] : []));
}

function semesterStart(
  scheduleRows: readonly GraduateScheduleRow[],
  courseRows: readonly GraduateCourseRow[],
): string | null {
  const starts = new Set<string>();
  for (const course of courseRows) {
    const rows = scheduleRows.filter((row) => row.BJDM === course.BJDM);
    const offsets = rows.flatMap((row) => {
      const firstWeek = weekNumbers(row.ZCBH)[0];
      return firstWeek === undefined ? [] : [(firstWeek - 1) * 7 + row.XQ - 1];
    });
    if (offsets.length === 0) continue;
    const firstDate = new Date(`${course.SCSKRQ}T00:00:00Z`);
    if (
      !Number.isFinite(firstDate.getTime()) ||
      firstDate.toISOString().slice(0, 10) !== course.SCSKRQ
    )
      continue;
    const monday = new Date(firstDate.getTime() - Math.min(...offsets) * 86400000);
    starts.add(monday.toISOString().slice(0, 10));
  }
  return starts.size === 1 ? [...starts][0]! : null;
}

export function mapGraduateTimetable(
  semester: string,
  scheduleRows: readonly GraduateScheduleRow[],
  courseRows: readonly GraduateCourseRow[],
) {
  const courses = new Map(courseRows.map((row) => [row.BJDM, row]));
  const groups = new Map<string, GraduateScheduleRow[]>();
  for (const row of scheduleRows) {
    const key = JSON.stringify([row.BJDM, row.XQ, row.ZCBH, row.JASMC, row.JSXM]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const lessons: {
    semester: string;
    sourceId: string;
    courseCode: string;
    courseName: string;
    className: string | null;
    teacher: string | null;
    campus: string | null;
    classroom: string | null;
    weekday: number;
    startPeriod: number;
    endPeriod: number;
    periodsText: string;
    weeksText: string;
    weekNumbers: string;
    credits: null;
    note: string | null;
  }[] = [];

  for (const rows of groups.values()) {
    rows.sort((a, b) => a.KSJCDM - b.KSJCDM);
    let run: GraduateScheduleRow[] = [];
    const appendRun = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run.at(-1)!;
      const course = courses.get(first.BJDM);
      lessons.push({
        semester,
        sourceId: first.WID,
        courseCode: course?.KCDM.trim() || first.KCDM.trim(),
        courseName: course?.KCMC.trim() || first.KCMC.trim(),
        className: course?.BJMC?.trim() || first.BJMC?.trim() || null,
        teacher: course?.RKJS?.trim() || first.JSXM?.trim() || null,
        campus: course?.XQDM_DISPLAY?.trim() || null,
        classroom: first.JASMC?.trim() || null,
        weekday: first.XQ,
        startPeriod: first.KSJCDM,
        endPeriod: last.JSJCDM,
        periodsText:
          first.KSJCDM === last.JSJCDM ? `${first.KSJCDM}节` : `${first.KSJCDM}-${last.JSJCDM}节`,
        weeksText: first.ZCMC.trim(),
        weekNumbers: JSON.stringify(weekNumbers(first.ZCBH)),
        credits: null,
        note: course?.XKBZ?.trim() || first.KBBZ?.trim() || null,
      });
    };
    for (const row of rows) {
      if (run.length > 0 && row.KSJCDM !== run.at(-1)!.JSJCDM + 1) {
        appendRun();
        run = [];
      }
      run.push(row);
    }
    appendRun();
  }

  return { lessons, semesterStart: semesterStart(scheduleRows, courseRows) };
}

export async function fetchGraduateTimetable(semester: string) {
  const campus = await getCampusSession();
  const code = semesterCode(semester);
  const request = (url: string, body: URLSearchParams) =>
    campusRequest(campus, url, {
      service: '研究生课表',
      loginError: '研究生教学信息平台登录已失效，请重新登录',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: GRADUATE_LOGIN_URL,
      },
      body: body.toString(),
    });

  const [scheduleText, courseText] = await Promise.all([
    request(SCHEDULE_URL, new URLSearchParams({ XNXQDM: code, XH: '' })),
    request(
      COURSES_URL,
      new URLSearchParams({ XNXQDM: code, XH: '', pageNumber: '1', pageSize: '999' }),
    ),
  ]);

  let schedulePayload: unknown;
  let coursePayload: unknown;
  try {
    schedulePayload = JSON.parse(scheduleText);
    coursePayload = JSON.parse(courseText);
  } catch {
    throw new Error('研究生课表接口没有返回预期的数据，请重新登录后再试');
  }
  const schedule = scheduleResponseSchema.safeParse(schedulePayload);
  const course = courseResponseSchema.safeParse(coursePayload);
  if (!schedule.success || !course.success) throw new Error('研究生课表返回了无法识别的数据');
  return mapGraduateTimetable(
    semester,
    schedule.data.datas.xspkjgcx.rows,
    course.data.datas.xsjxrwcx.rows,
  );
}
