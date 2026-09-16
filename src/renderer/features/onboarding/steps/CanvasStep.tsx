import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { connectCanvas } from '../../sources/canvas-connect';
import { errorText } from '../../projects/workspace';
import { StepButton, StepInput, type StepButtonState } from './step-controls';

/** 向导 · Canvas 步骤：验证个人 Access Token 并同步课程，按钮转为「下一步」。 */
export function CanvasStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="Canvas Token 与课程缓存不会暴露给浏览器。"
        title="Canvas 仅在 Dela 桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await connectCanvas(token);
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 Canvas</h2>
        <p className="text-sm leading-relaxed text-neutral-500">
          输入个人 Access Token，同步课程、作业与资料。凭据经系统加密保存在本机。
        </p>
      </header>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">Access Token</span>
          <StepInput
            autoComplete="off"
            autoFocus
            onChange={(event) => setToken(event.target.value)}
            required
            type="password"
            value={token}
          />
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <StepButton
          busyLabel="正在同步课程…"
          idleLabel="保存并连接"
          state={state}
          successLabel="连接成功，下一步"
        />
      </form>
    </div>
  );
}
