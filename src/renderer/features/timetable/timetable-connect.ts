import type { TimetableSource } from '../../../shared/api';

/** 登录教学信息服务网并同步指定学期（不传由主进程取默认学期）；失败返回错误文案，成功返回 null。 */
export async function connectAndSyncTimetable(
  semester?: string,
  source: TimetableSource = 'auto',
): Promise<string | null> {
  const timetable = window.dela!.timetable;
  const connected = await timetable.connect(source);
  if (!connected.ok) return connected.error ?? '未完成登录';
  const result = await timetable.syncNow(semester, source);
  if (!result.ok) return result.error ?? '同步失败';
  return null;
}
