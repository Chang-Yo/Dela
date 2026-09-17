import { useState } from 'react';
import { CalendarDays, LogIn } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { connectAndSyncTimetable } from './timetable-connect';

type TimetableConnectCardProps = {
  /** 登录成功后要同步的学期；不传由主进程取默认学期。 */
  semester?: string;
  /** 登录并同步成功后的回调（宿主负责刷新自己的状态）。 */
  onSuccess: () => void;
};

/** 未连接时的登录卡：登录在独立窗口完成，成功后同步课程。课表页与首启向导共用。 */
export function TimetableConnectCard({ semester, onSuccess }: TimetableConnectCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectAndSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const failure = await connectAndSyncTimetable(semester);
      if (failure) return setError(failure);
      onSuccess();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid w-full max-w-[480px] justify-items-start gap-3 rounded-xl border bg-card p-6">
      <div className="grid size-10 place-items-center rounded-lg bg-secondary">
        <CalendarDays className="size-5" />
      </div>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">连接教学信息服务网</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          登录后读取课程、教师、教室、节次和教学周。登录在独立窗口完成。
        </p>
      </div>
      {error ? <p className="break-words text-xs text-destructive">{error}</p> : null}
      <Button disabled={busy} onClick={() => void connectAndSync()}>
        <LogIn className="size-4" />
        {busy ? '等待登录…' : '登录并同步'}
      </Button>
    </section>
  );
}
