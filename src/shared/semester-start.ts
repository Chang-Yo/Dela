// 开学日期推断：课表接口没能给出学期开始日期时，用课堂录像里最早的一节课反推。
// 录像只会晚于开学日（第一周可能没录到、课程可能第 2 周才开），所以这里只产出候选值与证据，
// 由调用方交给用户确认后再写入，不在推断环节落库。

export interface SemesterRecording {
  courseId: number;
  courseName: string;
  /** 录像开始时间，形如 `2026-09-14 11:50:20`，只取前 10 位日期。 */
  start: string;
}

export interface SemesterStartEvidence {
  courseId: number;
  courseName: string;
  firstDay: string;
  recordings: number;
  /** 该课程最早一节课落在候选周的第几天（1=周一）。 */
  weekday: number;
}

export interface SemesterStartGuess {
  semester: string;
  /** 候选开学日期：最早一节课所在周的周一，YYYY-MM-DD。 */
  candidate: string | null;
  firstTeachingDay: string | null;
  /** 推断依据的课程数，以及与该周一对齐的课程数。 */
  courses: number;
  agreement: number;
  confidence: 'high' | 'low' | 'none';
  evidence: SemesterStartEvidence[];
  warnings: string[];
}

/** 与录像推断结果一起返回的额外信息：扫了几门课、哪几门读不到。 */
export interface SemesterStartInference extends SemesterStartGuess {
  checkedCourses: number;
  failures: string[];
}

const semesterPattern = /^(\d{4})-(\d{4})-([123])$/;
const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayMilliseconds = 86400000;

function toUtc(day: string): number | null {
  const matched = dayPattern.exec(day);
  if (!matched) return null;
  const [, year, month, date] = matched;
  const millis = Date.UTC(Number(year), Number(month) - 1, Number(date));
  return new Date(millis).toISOString().slice(0, 10) === day ? millis : null;
}

function toMonday(millis: number): number {
  return millis - ((new Date(millis).getUTCDay() + 6) % 7) * dayMilliseconds;
}

/**
 * 学期对应的大致日历窗口，用于把其他学期的录像排除在外。
 * 交大校历秋学期 9 月开学、春学期 2 月开学；浦江国际学院等学院偶有提前或延后，
 * 窗口特意放宽，只做粗略过滤，精确日期仍以推断结果加用户确认为准。
 */
export function semesterWindow(semester: string): { start: string; end: string } | null {
  const matched = semesterPattern.exec(semester);
  if (!matched) return null;
  const [, first, second, term] = matched;
  const startYear = Number(first);
  const endYear = Number(second);
  if (term === '1') return { start: `${startYear}-08-01`, end: `${endYear}-02-28` };
  if (term === '2') return { start: `${endYear}-01-01`, end: `${endYear}-08-31` };
  return { start: `${endYear}-05-01`, end: `${endYear}-10-31` };
}

/** 只保留 `YYYY-MM-DD` 前缀可解析为真实日期的录像。 */
export function recordingDay(start: string): string | null {
  const day = start.slice(0, 10);
  return toUtc(day) === null ? null : day;
}

export function inferSemesterStart(
  semester: string,
  recordings: readonly SemesterRecording[],
): SemesterStartGuess {
  const warnings: string[] = [];
  const window = semesterWindow(semester);
  if (!window)
    return {
      semester,
      candidate: null,
      firstTeachingDay: null,
      courses: 0,
      agreement: 0,
      confidence: 'none',
      evidence: [],
      warnings: [`学期格式无法识别：${semester}`],
    };

  const perCourse = new Map<
    number,
    { courseName: string; first: string; last: string; recordings: number }
  >();
  let outside = 0;
  for (const recording of recordings) {
    const day = recordingDay(recording.start);
    if (!day) continue;
    if (day < window.start || day > window.end) {
      outside += 1;
      continue;
    }
    const existing = perCourse.get(recording.courseId);
    if (!existing) {
      perCourse.set(recording.courseId, {
        courseName: recording.courseName,
        first: day,
        last: day,
        recordings: 1,
      });
      continue;
    }
    existing.recordings += 1;
    if (day < existing.first) existing.first = day;
    if (day > existing.last) existing.last = day;
  }

  const evidence: SemesterStartEvidence[] = [...perCourse.entries()]
    .map(([courseId, value]) => ({
      courseId,
      courseName: value.courseName,
      firstDay: value.first,
      recordings: value.recordings,
      weekday: ((new Date(toUtc(value.first)!).getUTCDay() + 6) % 7) + 1,
    }))
    .sort(
      (a, b) => a.firstDay.localeCompare(b.firstDay) || a.courseName.localeCompare(b.courseName),
    );

  if (!evidence.length) {
    if (outside)
      warnings.push(
        `${outside} 段录像都不在 ${semester} 的时间窗口（${window.start} ~ ${window.end}）内，无法推断`,
      );
    else warnings.push('该学期没有任何课堂录像，无法据此推断开学日期');
    return {
      semester,
      candidate: null,
      firstTeachingDay: null,
      courses: 0,
      agreement: 0,
      confidence: 'none',
      evidence,
      warnings,
    };
  }

  const firstTeachingDay = evidence[0]!.firstDay;
  const monday = new Date(toMonday(toUtc(firstTeachingDay)!)).toISOString().slice(0, 10);
  const agreement = evidence.filter(
    (item) => toMonday(toUtc(item.firstDay)!) === toMonday(toUtc(firstTeachingDay)!),
  ).length;
  const confidence = evidence.length >= 2 && agreement >= 2 ? 'high' : 'low';

  if (evidence.length === 1)
    warnings.push(
      '只有 1 门课程有录像：如果它并非第 1 周开课，推断出的开学日期会偏晚，需要向用户确认',
    );
  else if (agreement === 1) warnings.push('各门课最早录像不在同一周，推断值取最早的一门，可能偏晚');
  if (outside) warnings.push(`已忽略 ${outside} 段不在该学期窗口内的录像`);

  return {
    semester,
    candidate: monday,
    firstTeachingDay,
    courses: evidence.length,
    agreement,
    confidence,
    evidence,
    warnings,
  };
}
