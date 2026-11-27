import { z } from 'zod';
import { CampusAuthError, campusRequest, getCampusSession, hiddenCampusLogin } from '../../campus';

const GRADUATE_CAMPUS_ORIGIN = 'https://yjs.sjtu.edu.cn';
const GRADUATE_LOGIN_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/*default/index.do?THEME=purple&EMAP_LANG=zh#/xskcb`;
const SCHEDULE_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/modules/xskcb/xspkjgcx.do`;
const COURSES_URL = `${GRADUATE_CAMPUS_ORIGIN}/gsapp/sys/wdkbapp/modules/xskcb/xsjxrwcx.do`;

const text = z.string().nullish();
const integer = (max: number) => z.coerce.number().int().min(1).max(max);

// 逐行校验：没有排课时间的课程（论文、实践等）整行跳过，不让一行异常拖垮整张课表。
const scheduleRowSchema = z.object({
  BJDM: z.string().min(1),
  BJMC: text,
  JASMC: text,
  JSJCDM: integer(20),
  JSXM: text,
  KBBZ: text,
  KCDM: text,
  KCMC: z.string().min(1),
  KSJCDM: integer(20),
  WID: text,
  XQ: integer(7),
  ZCBH: z.string().regex(/^[01]+$/),
  ZCMC: text,
});

const courseRowSchema = z.object({
  BJDM: z.string().min(1),
  BJMC: text,
  KCDM: text,
  KCMC: text,
  RKJS: text,
  SCSKRQ: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .transform((value) => value.slice(0, 10))
    .nullish(),
  XKBZ: text,
  XQDM_DISPLAY: text,
});

const envelopeSchema = z.object({
  code: z.union([z.string(), z.number()]),
  msg: z.string().nullish(),
  datas: z.record(z.string(), z.unknown()).nullish(),
});

type ScheduleRow = z.infer<typeof scheduleRowSchema>;
type CourseRow = z.infer<typeof courseRowSchema>;

function validRows<T>(rows: readonly unknown[], schema: z.ZodType<T>) {
  const valid: T[] = [];
  let issue: string | null = null;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
    else {
      const first = parsed.error.issues[0];
      issue ??= first ? `${first.path.join('.') || '整行'}：${first.message}` : '未知字段';
    }
  }
  return { valid, issue };
}

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
  scheduleRows: readonly ScheduleRow[],
  courseRows: readonly CourseRow[],
): string | null {
  const starts = new Set<string>();
  for (const course of courseRows) {
    if (!course.SCSKRQ) continue;
    const offsets = scheduleRows
      .filter((row) => row.BJDM === course.BJDM)
      .flatMap((row) => {
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
  rawScheduleRows: readonly unknown[],
  rawCourseRows: readonly unknown[],
) {
  const { valid: scheduleRows, issue } = validRows(rawScheduleRows, scheduleRowSchema);
  if (rawScheduleRows.length > 0 && scheduleRows.length === 0)
    throw new Error(`研究生课表返回了无法识别的数据（${issue}）`);
  const courseRows = validRows(rawCourseRows, courseRowSchema).valid;
  const courses = new Map(courseRows.map((row) => [row.BJDM, row]));
  const groups = new Map<string, ScheduleRow[]>();
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
    let run: ScheduleRow[] = [];
    const appendRun = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run.at(-1)!;
      const course = courses.get(first.BJDM);
      lessons.push({
        semester,
        sourceId: first.WID || `${first.BJDM}-${first.XQ}-${first.KSJCDM}`,
        courseCode: course?.KCDM?.trim() || first.KCDM?.trim() || '',
        courseName: course?.KCMC?.trim() || first.KCMC.trim(),
        className: course?.BJMC?.trim() || first.BJMC?.trim() || null,
        teacher: course?.RKJS?.trim() || first.JSXM?.trim() || null,
        campus: course?.XQDM_DISPLAY?.trim() || null,
        classroom: first.JASMC?.trim() || null,
        weekday: first.XQ,
        startPeriod: first.KSJCDM,
        endPeriod: last.JSJCDM,
        periodsText:
          first.KSJCDM === last.JSJCDM ? `${first.KSJCDM}节` : `${first.KSJCDM}-${last.JSJCDM}节`,
        weeksText: first.ZCMC?.trim() || '周次未提供',
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

async function graduateRows(url: string, key: string, body: URLSearchParams): Promise<unknown[]> {
  const response = await campusRequest(await getCampusSession(), url, {
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
  let payload: unknown;
  try {
    payload = JSON.parse(response);
  } catch {
    throw new Error('研究生课表接口没有返回预期的数据，请重新登录后再试');
  }
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) throw new Error('研究生课表返回了无法识别的数据（响应结构）');
  if (String(envelope.data.code) !== '0')
    throw new Error(`研究生课表接口返回错误：${envelope.data.msg || envelope.data.code}`);
  const rows = z.object({ rows: z.array(z.unknown()) }).safeParse(envelope.data.datas?.[key]);
  if (!rows.success) throw new Error(`研究生课表返回了无法识别的数据（datas.${key}）`);
  return rows.data.rows;
}

async function readGraduateTimetable(semester: string) {
  const code = semesterCode(semester);
  const [scheduleRows, courseRows] = await Promise.all([
    graduateRows(SCHEDULE_URL, 'xspkjgcx', new URLSearchParams({ XNXQDM: code, XH: '' })),
    graduateRows(
      COURSES_URL,
      'xsjxrwcx',
      new URLSearchParams({ XNXQDM: code, XH: '', pageNumber: '1', pageSize: '999' }),
    ),
  ]);
  return mapGraduateTimetable(semester, scheduleRows, courseRows);
}

/** 本科课表为空时调用。教学信息服务网的登录已带上 jAccount 单点登录，
 *  研究生平台未登录时在隐藏窗口里自动跳转完成，不再弹第二个登录窗口。 */
export async function fetchGraduateTimetable(semester: string) {
  try {
    return await readGraduateTimetable(semester);
  } catch (error) {
    if (!(error instanceof CampusAuthError)) throw error;
  }
  try {
    // 只有登录失效才继续等待；接口已能访问时，数据问题交给下面的正式读取报告。
    await hiddenCampusLogin(GRADUATE_LOGIN_URL, () =>
      readGraduateTimetable(semester).then(
        () => {},
        (error: unknown) => {
          if (error instanceof CampusAuthError) throw error;
        },
      ),
    );
  } catch {
    throw new Error(
      '本科课表为空，研究生教学信息平台也未能登录；请确认所选学期，原有课表不会被清除',
    );
  }
  return readGraduateTimetable(semester);
}
