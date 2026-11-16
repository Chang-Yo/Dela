import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, LogIn } from 'lucide-react';
import { Button } from '../../../ui/button';
import { ConnectCard } from '../../../ui/connect-card';
import { showToast } from '../../../ui/toast';
import { connectAndSyncTimetable } from './use-timetable';

export function TimetableConnectCard({ semester }: { semester: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const connectAndSync = async () => {
    setBusy(true);
    const connect = async () => {
      const failure = await connectAndSyncTimetable(semester);
      if (failure) {
        showToast({ variant: 'error', title: '登录同步失败', description: failure });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['timetable'] });
    };
    await connect().finally(() => setBusy(false));
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto p-6">
      <ConnectCard
        className="m-auto"
        description="登录后读取课程、教师、教室、节次和教学周。登录在独立窗口完成。"
        icon={CalendarDays}
        title="连接教学信息服务网"
      >
        <Button disabled={busy} onClick={() => void connectAndSync()}>
          <LogIn className="size-4" />
          {busy ? '等待登录…' : '登录并同步'}
        </Button>
      </ConnectCard>
    </div>
  );
}
