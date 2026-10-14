import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { errorText } from '../../../workspace/store';
import { StepButton, StepTextarea, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';

/** 向导 · 水源步骤：独立窗口完成 jAccount 登录与授权，粘贴密钥绑定，按钮转为「下一步」。 */
export function ShuiyuanStep({ onDone }: { onDone: () => void }) {
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
  const shuiyuan = window.dela.shuiyuan;

  const startAuth = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      await shuiyuan.startAuth();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setAuthBusy(false);
    }
  };

  const bind = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await shuiyuan.bind(payload);
      setState('success');
    } catch (cause) {
      setError(errorText(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接水源社区</h2>
        <p className="text-13 leading-relaxed text-ink-3">绑定后可浏览水源并回复、发私信。</p>
      </header>
      <StepGuide
        steps={[
          {
            title: '登录并授权',
            content: (
              <div className="grid gap-3">
                <p className="text-13 leading-relaxed text-ink-3">
                  在独立窗口登录 jAccount 并点击「授权」，然后复制页面显示的密钥并关闭弹窗。
                </p>
                <button
                  className="h-10 w-full rounded-card border border-line border-line-strong bg-surface text-13 font-medium text-ink transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={authBusy}
                  onClick={() => void startAuth()}
                  type="button"
                >
                  {authBusy ? '正在打开授权窗口…' : '登录并授权'}
                </button>
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
                  <span className="flex items-center gap-1.5 text-13 font-medium text-ink-2">
                    <KeyRound className="size-3.5 text-ink-3" aria-hidden="true" />
                    授权密钥
                  </span>
                  <StepTextarea
                    onChange={(event) => setPayload(event.target.value)}
                    placeholder="粘贴授权密钥"
                    required
                    rows={4}
                    spellCheck={false}
                    value={payload}
                  />
                </label>
                {error && (
                  <p className="text-13 [overflow-wrap:anywhere] text-red-600" role="alert">
                    {error}
                  </p>
                )}
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
