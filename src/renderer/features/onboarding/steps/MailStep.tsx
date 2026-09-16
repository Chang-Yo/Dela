import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { errorText } from '../../projects/workspace';
import { StepButton, StepInput, type StepButtonState } from './step-controls';

/** 向导 · 邮箱步骤：验证 IMAP 登录，成功后后台开始首次同步，按钮转为「下一步」。 */
export function MailStep({ onDone }: { onDone: () => void }) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
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

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    const dela = window.dela;
    if (!dela) return;
    setState('busy');
    setError(null);
    try {
      const result = await dela.mail.configure({ address, password });
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
      <h2 className="text-2xl font-semibold tracking-tight">连接交大邮箱</h2>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">邮箱地址</span>
          <StepInput
            autoComplete="off"
            onChange={(event) => setAddress(event.target.value)}
            placeholder="name@sjtu.edu.cn"
            required
            type="email"
            value={address}
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">密码</span>
          <StepInput
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="jAccount 密码"
            required
            type="password"
            value={password}
          />
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <StepButton
          busyLabel="正在连接…"
          idleLabel="连接并同步"
          state={state}
          successLabel="连接成功，下一步"
        />
      </form>
    </div>
  );
}
