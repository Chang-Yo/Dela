// 日历按本地时区、周一为一周之首。
export const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export const dayMilliseconds = 86_400_000;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function roundToMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function mondayOf(date: Date): Date {
  const day = date.getDay() || 7;
  return addDays(startOfDay(date), 1 - day);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function weekdayName(date: Date): string {
  return weekDays[(date.getDay() + 6) % 7]!;
}

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
