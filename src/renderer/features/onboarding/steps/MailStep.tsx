import { useState } from 'react';
import type { MailConfigureInput } from '../../../../shared/mail';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { MailAccountForm } from '../../mail/MailAccountForm';
import { errorText } from '../../../workspace/store';
import { StepButton, type StepButtonState } from './step-controls';

/** 向导 · 邮箱步骤：验证 IMAP 登录，成功后后台开始首次同步，按钮转为「下一步」。 */
export function MailStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="邮箱凭据不会暴露给浏览器。"
        title="邮箱仅在 Dela 桌面端可用"
      />
    );
  }

  const submit = async (input: MailConfigureInput) => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    const dela = window.dela;
    if (!dela) return;
    setState('busy');
    setError(null);
    try {
      const result = await dela.mail.configure(input);
      if (!result.ok) {
        setError(result.error);
        setState('idle');
        return;
      }
      // 同步进度由 mail:sync-status 事件展示，向导里不等它完成。
      void dela.mail.syncNow().catch(() => {});
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <h2 className="text-2xl font-semibold tracking-tight">连接邮箱</h2>
      <MailAccountForm
        error={error}
        onSubmit={(input) => void submit(input)}
        submit={
          <StepButton
            busyLabel="正在连接…"
            idleLabel="连接并同步"
            state={state}
            successLabel="连接成功，下一步"
          />
        }
        variant="wizard"
      />
    </div>
  );
}
