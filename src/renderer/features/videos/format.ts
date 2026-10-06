/** 课堂视频展示格式化：平台时间为 "YYYY-MM-DD HH:mm[:ss]" 文本，直接切片展示。 */

/** "2026-09-24 14:00:00" → "09-24 14:00"；不完整时原样返回。 */
export function formatBeginTime(value: string): string {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
  return time ? `${date.slice(5)} ${time}` : date.slice(5);
}

/** 秒 → "95 分钟" / "45 分 30 秒"；缺失返回空串。 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes === 0) return `${rest} 秒`;
  if (rest === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${rest} 秒`;
}

/** 毫秒时间戳（转写行） → "MM:SS" / "H:MM:SS"。 */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** 秒 → formatClock 同款。 */
export function formatSeconds(seconds: number): string {
  return formatClock(seconds * 1000);
}
