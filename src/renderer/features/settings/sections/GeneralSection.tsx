import { useEffect, useState } from 'react';
import { Switch } from '../../../components/ui/switch';
import { SectionHeader } from '../SectionHeader';
import { SystemNotifications } from './SystemNotifications';

/** 设置 › 通用：应用行为（开机自启动）与系统通知偏好。 */
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
      <SectionHeader title="通用" />
      {/* 开机自启动与系统通知同区展示，行间分隔线承担边界。 */}
      <section className="grid gap-3">
        <div
          className="flex items-center justify-between gap-3 border-b pb-3"
          data-setting-id="open-at-login"
        >
          <h2 className="text-sm font-medium">开机自启动</h2>
          <Switch
            checked={openAtLogin ?? true}
            disabled={openAtLogin === null || busy}
            label="开机自启动"
            onChange={(next) => void toggleOpenAtLogin(next)}
          />
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <SystemNotifications />
      </section>
    </div>
  );
}
