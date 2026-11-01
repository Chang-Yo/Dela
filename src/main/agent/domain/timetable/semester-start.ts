import { z } from 'zod';
import { currentSemester, getTimetableState, setSemesterStart } from '../../../timetable/api';
import { inferSemesterStartFromVideos } from '../../../timetable/semester-start';
import { tool } from '../shared';

const semesterPattern = /^\d{4}-\d{4}-[123]$/;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const semesterSchema = z.string().regex(semesterPattern, '学期格式为 YYYY-YYYY-[123]');

function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return ((new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay() + 6) % 7) + 1;
}

export const inferSemesterStartTool = tool(
  '联网用课堂录像推断学期开学日期（只读，不写入课表）。课表缺开学日期时先调用它，把候选日期与证据转述给用户确认，确认后再用 set_semester_start 写入。录像只会晚于真实开学日，因此结果可能偏晚，不要直接当成事实。',
  z
    .object({
      semester: semesterSchema.optional(),
      maxCourses: z.number().int().min(1).max(30).default(12),
    })
    .strict(),
  async ({ semester, maxCourses }) => {
    const target = semester ?? currentSemester();
    const state = getTimetableState(target);
    const guess = await inferSemesterStartFromVideos(target, maxCourses);

    const warnings = [...guess.warnings];
    if (target !== currentSemester())
      warnings.push('课堂录像只覆盖当前学期，跨学期推断没有意义，请让用户手动填写日期');
    if (state.semesterStart)
      warnings.push(`该学期已有开学日期 ${state.semesterStart}，仅在与推断值不同时才需要修改`);
    if (guess.failures.length) warnings.push(`部分课程录像读取失败：${guess.failures.join('；')}`);

    return {
      ...guess,
      storedSemesterStart: state.semesterStart,
      written: false,
      nextStep: guess.candidate
        ? `把候选日期 ${guess.candidate}（第一周的周一）与怀疑点告诉用户，得到确认后调用 set_semester_start`
        : '没有足够的录像可用，请让用户直接提供开学日期或到课表页面手动设置',
      warnings,
    };
  },
);

export const setSemesterStartTool = tool(
  '写入学期开学日期（本地写，只影响本地课表换算，不修改学校课表）。只在用户确认了推断值或自己给出日期后调用；传入开学第一周的周一。',
  z
    .object({
      semester: semesterSchema.optional(),
      date: z.string().regex(dayPattern, '日期格式为 YYYY-MM-DD'),
    })
    .strict(),
  ({ semester, date }) => {
    const target = semester ?? currentSemester();
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10);
    if (parsed !== date) throw new Error('日期不存在');
    setSemesterStart(target, date);
    const weekday = weekdayOf(date);
    // 回传第 1 周的起止日期，调用方可据此核对周次换算是否符合预期。
    const weekOneStart = new Date(Date.UTC(year!, month! - 1, day!) - (weekday - 1) * 86400000);
    return {
      semester: target,
      semesterStart: date,
      weekday,
      written: true,
      weekOne: {
        start: weekOneStart.toISOString().slice(0, 10),
        end: new Date(weekOneStart.getTime() + 6 * 86400000).toISOString().slice(0, 10),
      },
      ...(weekday === 1
        ? {}
        : {
            warning: `${date} 是周${'一二三四五六日'[weekday - 1]}，不是周一；开学日期按第一周的周一存储`,
          }),
    };
  },
);
