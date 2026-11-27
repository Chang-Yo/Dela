import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { errorMessage } from '../../../../core/protocol/contract';
import { Button } from '../../../../ui/button';
import { DesktopOnlyNotice } from '../../../../ui/desktop-only-notice';
import { ErrorText } from '../../../../ui/error-text';
import { Input } from '../../../../ui/input';
import { capabilitiesClient } from '../../../chat/view';
import { StepButton, type StepButtonState } from '../step-controls';
import { StepGuide } from '../step-guide';

const TOKEN_PAGE = 'https://mineru.net/apiManage/token';

export function DocumentStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="MinerU Token 只加密保存在桌面端。"
        title="文档读取仅在 Dela 桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    try {
      await capabilitiesClient.saveDocumentToken(token);
      setState('success');
    } catch (cause) {
      setError(errorMessage(cause));
      setState('idle');
    }
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接 MinerU</h2>
        <p className="text-sm leading-relaxed text-ink-3">
          MinerU 能够为 Agent 提供高精度的文档解析功能（pdf, pptx, docx, xlsx
          等），支持识别复杂数学公式，混合图文排版。使用该服务时文档会上传至 MinerU 服务器。
        </p>
      </header>
      <StepGuide
        steps={[
          {
            title: '打开 MinerU 的 Token 页面',
            content: (
              <Button
                className="justify-self-start"
                onClick={() => window.open(TOKEN_PAGE)}
                type="button"
                variant="outline"
              >
                <ExternalLink aria-hidden="true" />
                打开 mineru.net
              </Button>
            ),
          },
          {
            title: '登录后创建 Token',
            content: (
              <p className="text-sm leading-relaxed text-ink-3">
                在「API Token」页点击创建，复制生成的 Token。
              </p>
            ),
          },
          {
            title: '粘贴到这里',
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
                  aria-label="MinerU Token"
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="MinerU Token"
                  required
                  type="password"
                  value={token}
                />
                {error && <ErrorText size="sm">{error}</ErrorText>}
                <StepButton
                  busyLabel="正在验证…"
                  idleLabel="保存并开启"
                  state={state}
                  successLabel="已开启，下一步"
                />
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
