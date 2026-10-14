import { useState, type FormEvent } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import type { ShuiyuanState } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';
import { Textarea } from '../../components/ui/textarea';
import { errorText } from '../../workspace/store';
import { showToast } from '../../app/toasts';
import { useShuiyuan } from './store';

/** 未绑定时的授权卡：发起授权窗口 → 粘贴密文 → 绑定。 */
export function BindCard() {
  const shuiyuan = window.dela!.shuiyuan;
  const init = useShuiyuan((state) => state.init);
  const [payload, setPayload] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bound, setBound] = useState<ShuiyuanState | null>(null);

  const startAuth = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      await shuiyuan.startAuth();
    } catch (reason) {
      showToast({ variant: 'error', title: '打开授权页面失败', description: errorText(reason) });
    } finally {
      setAuthBusy(false);
    }
  };

  const bind = async (event: FormEvent) => {
    event.preventDefault();
    setBindBusy(true);
    setError(null);
    try {
      setBound(await shuiyuan.bind(payload));
      setPayload('');
      // 绑定成功后立即刷新连接态：connected 置真时 ShuiyuanView 用信息流替换本卡片，
      // 不再依赖切走再切回触发重新挂载。
      void init();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBindBusy(false);
    }
  };

  if (bound) {
    return (
      <div className="grid h-full place-items-center p-6">
        <section className="grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
          <ShuiyuanIcon className="size-10 rounded-card" />
          <h2 className="text-lg font-semibold tracking-tight">绑定成功</h2>
          <p className="text-13 leading-relaxed text-ink-3">
            已绑定 @{bound.username}，即将进入水源。
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-y-auto p-6">
      <section className="m-auto grid w-full max-w-[30rem] justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
        <ShuiyuanIcon className="size-10 rounded-card" />
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold tracking-tight">连接水源社区</h2>
          <p className="text-13 leading-relaxed text-ink-3">
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
          {error ? <p className="text-xs text-red">{error}</p> : null}
          <Button disabled={bindBusy || payload.trim().length === 0} type="submit">
            {bindBusy ? '正在绑定…' : '绑定'}
          </Button>
        </form>
      </section>
    </div>
  );
}
