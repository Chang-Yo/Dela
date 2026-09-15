import { useEffect, useState, type FormEvent } from 'react';
import { BadgeCheck, KeyRound, LogIn, Unlink } from 'lucide-react';
import type { ShuiyuanState } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';

export function ShuiyuanView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="水源的授权密钥只在主进程保存和使用，不会暴露给浏览器。"
        title="水源仅在 Dela 桌面端可用"
      />
    );
  }
  return <DesktopShuiyuanView />;
}

function DesktopShuiyuanView() {
  const shuiyuan = window.dela!.shuiyuan;
  const [state, setState] = useState<ShuiyuanState | null>(null);
  const [payload, setPayload] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [unbindBusy, setUnbindBusy] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void shuiyuan
      .getState()
      .then(setState)
      .catch(() => setState({ connected: false, username: null, boundAt: null }));
  }, [shuiyuan]);

  const startAuth = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      await shuiyuan.startAuth();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAuthBusy(false);
    }
  };

  const bind = async (event: FormEvent) => {
    event.preventDefault();
    setBindBusy(true);
    setError(null);
    try {
      setState(await shuiyuan.bind(payload));
      setPayload('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBindBusy(false);
    }
  };

  const unbind = async () => {
    if (!confirmUnbind) {
      setConfirmUnbind(true);
      return;
    }
    setUnbindBusy(true);
    setError(null);
    try {
      await shuiyuan.unbind();
      setState({ connected: false, username: null, boundAt: null });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUnbindBusy(false);
      setConfirmUnbind(false);
    }
  };

  if (!state) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        正在读取绑定状态…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b bg-background/95 px-4 py-2 backdrop-blur max-md:px-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">水源</h1>
        <p className="text-[11px] text-muted-foreground">水源社区 · shuiyuan.sjtu.edu.cn</p>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
        <section className="grid w-full max-w-[480px] justify-items-start gap-3 rounded-xl border bg-card p-6">
          <ShuiyuanIcon className="size-10 rounded-lg" />
          {state.connected ? (
            <>
              <div className="grid gap-1">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
                  <BadgeCheck className="size-5 text-primary" />
                  已绑定水源社区
                </h2>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  账号 @{state.username} · 绑定于 {formatTime(state.boundAt)}
                </p>
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button disabled={unbindBusy} onClick={() => void unbind()} variant="outline">
                  <Unlink className="size-4" />
                  {unbindBusy ? '正在解除…' : confirmUnbind ? '确认解除绑定？' : '解除绑定'}
                </Button>
                {confirmUnbind && !unbindBusy ? (
                  <Button onClick={() => setConfirmUnbind(false)} size="sm" variant="ghost">
                    取消
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-1">
                <h2 className="text-lg font-semibold tracking-tight">连接水源社区</h2>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  授权 Dela 读取你在水源社区的数据（只读）。登录与授权在独立窗口完成。
                </p>
              </div>
              <Button disabled={authBusy} onClick={() => void startAuth()}>
                <LogIn className="size-4" />
                {authBusy ? '正在打开授权窗口…' : '登录并授权'}
              </Button>
              <form className="mt-1 grid w-full gap-2" onSubmit={(event) => void bind(event)}>
                <label
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                  htmlFor="shuiyuan-payload"
                >
                  <KeyRound className="size-3.5" />
                  在窗口中点击「授权」后，复制页面显示的密钥并粘贴到这里
                </label>
                <textarea
                  aria-invalid={Boolean(error)}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive dark:bg-input/30"
                  id="shuiyuan-payload"
                  onChange={(event) => setPayload(event.target.value)}
                  placeholder="粘贴授权密文"
                  rows={4}
                  spellCheck={false}
                  value={payload}
                />
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
                <Button disabled={bindBusy || payload.trim().length === 0} type="submit">
                  {bindBusy ? '正在绑定…' : '绑定'}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
