import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { StepButton, StepGuide, type StepButtonState } from '../../../modules/onboarding/view';
import { ErrorText } from '../../../ui/error-text';
import { Button } from '../../../ui/button';
import { Textarea } from '../../../ui/textarea';
import { shuiyuanClient } from './use-shuiyuan';

export function ShuiyuanOnboardingStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [authBusy, setAuthBusy] = useState(false);
  const [payload, setPayload] = useState('');
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="水源的授权会话不会暴露给浏览器。"
        title="水源社区仅在 Dela 桌面端可用"
      />
    );
  }

  const startAuth = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      await shuiyuanClient.startAuth();
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setAuthBusy(false);
  };

  const bind = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      queryClient.setQueryData(['shuiyuan', 'state'], await shuiyuanClient.bind(payload));
      setState('success');
    } catch (cause) {
      setError(errorMessage(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接水源社区</h2>
        <p className="text-sm leading-relaxed text-ink-3">绑定后可浏览水源并回复、发私信。</p>
      </header>
      <StepGuide
        steps={[
          {
            title: '登录并授权',
            content: (
              <div className="grid gap-3">
                <p className="text-sm leading-relaxed text-ink-3">
                  在独立窗口登录 jAccount 并点击「授权」，然后复制页面显示的密钥并关闭弹窗。
                </p>
                <Button
                  className="w-full"
                  disabled={authBusy}
                  onClick={() => void startAuth()}
                  size="lg"
                  variant="outline"
                >
                  {authBusy ? '正在打开授权窗口…' : '登录并授权'}
                </Button>
              </div>
            ),
          },
          {
            title: '粘贴密钥并绑定',
            content: (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void bind();
                }}
              >
                <label className="grid gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                    <KeyRound className="size-3.5 text-ink-3" aria-hidden="true" />
                    授权密钥
                  </span>
                  <Textarea
                    className="min-h-24 resize-y rounded-card px-3 py-2 font-mono text-xs"
                    onChange={(event) => setPayload(event.target.value)}
                    placeholder="粘贴授权密钥"
                    required
                    rows={4}
                    spellCheck={false}
                    value={payload}
                  />
                </label>
                {error && <ErrorText size="sm">{error}</ErrorText>}
                <StepButton
                  busyLabel="正在绑定…"
                  idleLabel="绑定"
                  state={state}
                  successLabel="绑定成功，下一步"
                />
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
