// 课堂视频展示格式化：场次标题/副标题、下载文件名、时长与字节数。
// 交大视频的时间字段是 "YYYY-MM-DD HH:mm:ss" 文本，按容错解析，解析失败原样展示。
import type { ClassroomVideo } from '../../../shared/vsjtu';

/** "12:34" / "1:02:03"；无效值回退 0:00。 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hour = Math.floor(total / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return hour > 0
    ? `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    : `${minute}:${String(second).padStart(2, '0')}`;
}

/** "404.6 MB"；非正数或无效回退 null。 */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function parseLectureDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value.trim(),
  );
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
}

/** "10月8日"；无法解析时原样返回。 */
export function lectureDay(start: string): string {
  const date = parseLectureDate(start);
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : start;
}

/** 纯数字节次补 "第N节"，其余（如 "1-2"）原样。 */
function normalizePeriod(period: string): string | null {
  const value = period.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? `第${value}节` : value;
}

function lectureClock(value: string): string | null {
  const match = /(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(value.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

/** 场次主标题："10月8日 · 第3节"。 */
export function lectureTitle(video: ClassroomVideo): string {
  const period = normalizePeriod(video.period);
  return period ? `${lectureDay(video.start)} · ${period}` : lectureDay(video.start);
}

/** 场次副标题："14:00–15:35 · 东上院405"；缺项跳过。 */
export function lectureMeta(video: ClassroomVideo): string {
  const begin = lectureClock(video.start);
  const end = lectureClock(video.end);
  const time = begin && end ? `${begin}–${end}` : (begin ?? end);
  return [time, video.room.trim() || null].filter(Boolean).join(' · ');
}

/** 下载建议名（不含扩展名与画面后缀，main 侧补 "-画面N.mp4"）：计算理论 20261008 第3节。 */
export function lectureFileName(courseName: string, video: ClassroomVideo): string {
  const date = parseLectureDate(video.start);
  const compact = date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    : null;
  return [courseName.trim(), compact, normalizePeriod(video.period)].filter(Boolean).join(' ');
}
