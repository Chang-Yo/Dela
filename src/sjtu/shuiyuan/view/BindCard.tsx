import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn } from 'lucide-react';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { ShuiyuanIcon } from './shuiyuan-icon';
import { Textarea } from '../../../ui/textarea';
import { showToast } from '../../../renderer/app/toasts';
import { shuiyuanClient } from './use-shuiyuan';

/** 未绑定时的授权卡：发起授权窗口 → 粘贴密文 → 绑定。 */
export function BindCard() {
  const queryClient = useQueryClient();
  const [payload, setPayload] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAuth = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      await shuiyuanClient.startAuth();
    } catch (reason) {
      showToast({ variant: 'error', title: '打开授权页面失败', description: errorMessage(reason) });
    } finally {
      setAuthBusy(false);
    }
  };

  const bind = async (event: FormEvent) => {
    event.preventDefault();
    setBindBusy(true);
    setError(null);
    try {
      // 连接态置真后水源页即用信息流替换本卡片；绑定前失败的读取一并重来。
      queryClient.setQueryData(['shuiyuan', 'state'], await shuiyuanClient.bind(payload));
      void queryClient.invalidateQueries({ queryKey: ['shuiyuan'] });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBindBusy(false);
    }
  };

  return (
    <div className="flex h-full overflow-y-auto p-6">
      <section className="m-auto grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
        <ShuiyuanIcon className="size-10 rounded-card" />
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">连接水源社区</h2>
          <p className="text-sm leading-relaxed text-ink-3">
            授权 Dela 读取你的水源数据并支持回复、私信（读取 + 写入）。登录与授权在独立窗口完成。
          </p>
        </div>
        <Button disabled={authBusy} onClick={() => void startAuth()}>
          <LogIn className="size-4" />
          {authBusy ? '正在打开授权窗口…' : '登录并授权'}
        </Button>
        <form className="mt-1 grid w-full gap-2" onSubmit={(event) => void bind(event)}>
          <label
            className="flex items-center gap-1.5 text-xs font-medium text-ink-3"
            htmlFor="shuiyuan-payload"
          >
            <KeyRound className="size-3.5" />
            在窗口中点击「授权」后，复制页面显示的密钥并粘贴到这里
          </label>
          <Textarea
            aria-invalid={Boolean(error)}
            className="min-h-20 resize-y py-2 font-mono text-xs"
            id="shuiyuan-payload"
            onChange={(event) => setPayload(event.target.value)}
            placeholder="粘贴授权密文"
            rows={4}
            spellCheck={false}
            value={payload}
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <Button disabled={bindBusy || payload.trim().length === 0} type="submit">
            {bindBusy ? '正在绑定…' : '绑定'}
          </Button>
        </form>
      </section>
    </div>
  );
}
