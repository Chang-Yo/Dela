import { useEffect, useState } from 'react';
import { Switch } from '../../components/ui/switch';
import { SectionHeader } from './SectionHeader';

export function GeneralSection() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.settings
      .getOpenAtLogin()
      .then(setOpenAtLogin)
      .catch(() => setOpenAtLogin(true));
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化并同步系统启动项。
  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setOpenAtLogin(window.dela ? await window.dela.settings.setOpenAtLogin(next) : next);
    } catch {
      setError('开机自启动设置保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <SectionHeader description="应用的基础行为设置。" title="通用" />
      <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">开机自启动</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">登录系统后自动启动 Dela。</p>
        </div>
        <div className="flex items-center justify-end">
          <Switch
            checked={openAtLogin ?? true}
            disabled={openAtLogin === null || busy}
            label="开机自启动"
            onChange={(next) => void toggleOpenAtLogin(next)}
          />
        </div>
        {error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
