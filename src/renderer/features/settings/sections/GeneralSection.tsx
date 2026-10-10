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
  const [experiments, setExperiments] = useState<boolean | null>(null);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentError, setExperimentError] = useState<string | null>(null);

  const toggleExperiments = async (next: boolean) => {
    setExperimentBusy(true);
    setExperimentError(null);
    try {
      const enabled = window.dela ? await window.dela.settings.setExperimentalFeatures(next) : next;
      setExperiments(enabled);
    } catch {
      setExperimentError('试验功能设置保存失败，请重试。');
    } finally {
      setExperimentBusy(false);
    }
  };

  useEffect(() => {
    if (!window.dela) {
      setExperiments(false);
      return;
    }
    let active = true;
    void window.dela.settings
      .getExperimentalFeatures()
      .then((enabled) => {
        if (active) setExperiments(enabled);
      })
      .catch(() => {
        if (active) setExperimentError('试验功能设置读取失败，请重新打开设置。');
      });
    return () => {
      active = false;
    };
  }, []);

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
    <div className="grid gap-10">
      <SectionHeader title="通用" />
      <section className="grid gap-2">
        <h2 className="text-base font-semibold">启动</h2>
        <div
          className="flex items-center justify-between gap-3 border-b py-3 last:border-0"
          data-setting-id="open-at-login"
        >
          <h3 className="text-[13px] font-medium">开机自启动</h3>
          <Switch
            checked={openAtLogin ?? true}
            disabled={openAtLogin === null || busy}
            label="开机自启动"
            onChange={(next) => void toggleOpenAtLogin(next)}
          />
        </div>
        {error && (
          <p className="text-[12px] text-red" role="alert">
            {error}
          </p>
        )}
      </section>
      <SystemNotifications />
      <section className="grid gap-2" data-setting-id="experimental-features">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="grid gap-1">
            <h2 className="text-[13px] font-medium">试验功能</h2>
            <p className="text-[12px] text-ink-3">允许使用试验阶段的功能。</p>
          </div>
          <Switch
            label="试验功能"
            checked={experiments ?? false}
            disabled={experiments === null || experimentBusy}
            onChange={(next) => void toggleExperiments(next)}
          />
        </div>
        {experimentError && (
          <p className="text-[12px] text-red" role="alert">
            {experimentError}
          </p>
        )}
      </section>
    </div>
  );
}
