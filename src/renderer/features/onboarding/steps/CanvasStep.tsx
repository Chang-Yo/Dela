import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { connectCanvas } from '../../settings/connections/canvas-connect';
import { errorText } from '../../projects/workspace';
import { StepButton, StepInput, type StepButtonState } from './step-controls';
import { StepGuide } from './step-guide';

/** 向导 · Canvas 步骤：先指引在 Canvas 侧获取 Access Token，再粘贴验证并同步课程，按钮转为「下一步」。 */
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
          同步课程与作业，凭据加密保存在本机。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '获取 Access Token',
            content: (
              <ol className="list-decimal space-y-1.5 ps-4 text-[13px] leading-relaxed text-neutral-500">
                <li>浏览器打开 Canvas（oc.sjtu.edu.cn）并登录</li>
                <li>点击头像，进入「设置」</li>
                <li>在「允许融入使用的外部软件」处点「+ 创建新的访问许可证」</li>
                <li>用途自己取名，过期时间留空</li>
                <li>复制生成的字符串密钥</li>
              </ol>
            ),
          },
          {
            title: '粘贴并绑定',
            content: (
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
                    placeholder="粘贴 Access Token"
                    required
                    type="password"
                    value={token}
                  />
                </label>
                {error && (
                  <p className="text-sm [overflow-wrap:anywhere] text-red-600" role="alert">
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
            ),
          },
        ]}
      />
    </div>
  );
}
