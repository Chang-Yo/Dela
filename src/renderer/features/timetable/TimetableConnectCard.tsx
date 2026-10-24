import { useState } from 'react';
import { CalendarDays, LogIn } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { showToast } from '../../app/toasts';
import { connectAndSyncTimetable } from './timetable-connect';

type TimetableConnectCardProps = {
  /** 登录成功后要同步的学期；不传由主进程取默认学期。 */
  semester?: string;
  /** 登录并同步成功后的回调（宿主负责刷新自己的状态）。 */
  onSuccess: () => void;
};

/** 无同步记录时的登录卡：登录在独立窗口完成，成功后同步课程。课表页与首启向导共用。 */
export function TimetableConnectCard({ semester, onSuccess }: TimetableConnectCardProps) {
  const [busy, setBusy] = useState(false);

  const connectAndSync = async () => {
    setBusy(true);
    try {
      const failure = await connectAndSyncTimetable(semester);
      if (failure) {
        showToast({ variant: 'error', title: '登录同步失败', description: failure });
        return;
      }
      onSuccess();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
      <div className="grid size-10 place-items-center rounded-card bg-hover-2">
        <CalendarDays className="size-5" />
      </div>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">连接教学信息服务网</h2>
        <p className="text-13 leading-relaxed text-ink-3">
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
