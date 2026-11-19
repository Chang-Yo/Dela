import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { StepButton, StepGuide, type StepButtonState } from '../../../modules/onboarding/view';
import { ErrorText } from '../../../ui/alert';
import { DesktopOnlyNotice } from '../../../ui/desktop-only-notice';
import { Input } from '../../../ui/input';
import { canvasClient, stateKey } from './use-canvas';

export function CanvasOnboardingStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
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
      queryClient.setQueryData(stateKey, await canvasClient.connect(token));
      setState('success');
    } catch (cause) {
      setError(errorMessage(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 Canvas</h2>
        <p className="text-sm leading-relaxed text-ink-3">同步课程与作业，凭据加密保存在本机。</p>
      </header>
      <StepGuide
        steps={[
          {
            title: '获取 Access Token',
            content: (
              <ol className="list-decimal space-y-1.5 ps-4 text-sm leading-relaxed text-ink-3">
                <li>浏览器打开 Canvas（oc.sjtu.edu.cn）并登录</li>
                <li>点击头像，进入「设置」</li>
                <li>在「允许融入使用的外部软件」处点「+ 创建新的访问许可证」</li>
                <li>用途自己取名，过期时间留空</li>
                <li>复制生成的字符串密钥</li>
              </ol>
            ),
          },
          {
            title: '粘贴并绑定 Access Token',
            content: (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Input
                  size="lg"
                  aria-label="Access Token"
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Access Token"
                  required
                  type="password"
                  value={token}
                />
                {error && <ErrorText size="sm">{error}</ErrorText>}
                <StepButton
                  busyLabel="正在同步课程…"
                  idleLabel="保存并连接"
                  state={state}
                  successLabel="连接成功，下一步"
                />
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
