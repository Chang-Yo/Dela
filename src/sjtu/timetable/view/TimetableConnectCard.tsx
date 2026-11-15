import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, LogIn } from 'lucide-react';
import { Button } from '../../../ui/button';
import { showToast } from '../../../ui/toast';
import { connectAndSyncTimetable } from './use-timetable';

/** 无同步记录时的登录卡：登录在独立窗口完成，成功后同步该学期的课程。 */
export function TimetableConnectCard({ semester }: { semester: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const connectAndSync = async () => {
    setBusy(true);
    try {
      const failure = await connectAndSyncTimetable(semester);
      if (failure) {
        showToast({ variant: 'error', title: '登录同步失败', description: failure });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['timetable'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
      <div className="grid size-10 place-items-center rounded-card bg-fill">
        <CalendarDays className="size-5" />
      </div>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">连接教学信息服务网</h2>
        <p className="text-sm leading-relaxed text-ink-3">
          登录后读取课程、教师、教室、节次和教学周。登录在独立窗口完成。
        </p>
      </div>
      <Button disabled={busy} onClick={() => void connectAndSync()}>
        <LogIn className="size-4" />
        {busy ? '等待登录…' : '登录并同步'}
      </Button>
    </section>
  );
}
