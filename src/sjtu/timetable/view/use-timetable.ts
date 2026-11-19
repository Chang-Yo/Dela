import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createClient } from '../../../core/protocol/contract';
import { timetableContract } from '../contract';

export const timetableClient = createClient(timetableContract, window.dela?.bridge);

/** 不传学期时由主进程取当前学期。 */
export function useTimetableState(semester?: string) {
  return useQuery({
    queryKey: semester ? ['timetable', 'state', semester] : ['timetable', 'state'],
    queryFn: () => timetableClient.state(semester),
    placeholderData: keepPreviousData,
  });
}

export async function connectAndSyncTimetable(semester?: string): Promise<string | null> {
  const connected = await timetableClient.connect();
  if (!connected.ok) return connected.error ?? '未完成登录';
  const result = await timetableClient.sync(semester);
  if (!result.ok) return result.error ?? '同步失败';
  return null;
}
