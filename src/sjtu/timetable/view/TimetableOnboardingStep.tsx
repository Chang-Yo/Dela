import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { ErrorText } from '../../../ui/alert';
import { StepButton, type StepButtonState } from '../../../modules/onboarding/view';
import { connectAndSyncTimetable } from './use-timetable';

export function TimetableOnboardingStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="教学信息服务网的登录会话和本地课表缓存不会暴露给浏览器。"
        title="课表仅在 Dela 桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    const failure = await connectAndSyncTimetable();
    if (failure) {
      setError(failure);
      setState('idle');
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['timetable'] });
    setState('success');
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接教学信息服务网</h2>
        <p className="text-sm leading-relaxed text-ink-3">
          登录在独立窗口完成，Dela 只读取你的个人课表。
        </p>
      </header>
      {error && <ErrorText size="sm">{error}</ErrorText>}
      <StepButton
        busyLabel="等待登录…"
        idleLabel="登录并同步"
        onClick={() => void submit()}
        state={state}
        successLabel="连接成功，下一步"
        type="button"
      />
    </div>
  );
}
