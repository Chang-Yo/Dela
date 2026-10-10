import { useEffect, useState } from 'react';
import { Switch } from '../../../components/ui/switch';
import { useExperimental } from '../experimental';
import { SectionHeader } from '../SectionHeader';
import { SystemNotifications } from './SystemNotifications';

/** 设置 › 通用：应用行为（开机自启动）、系统通知偏好与试验功能（总开关 + 子项）。 */
export function GeneralSection() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const master = useExperimental((state) => state.master);
  const classroom = useExperimental((state) => state.classroom);
  const loadExperiments = useExperimental((state) => state.load);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [classroomBusy, setClassroomBusy] = useState(false);
  const [experimentError, setExperimentError] = useState<string | null>(null);

  const toggleExperiments = async (next: boolean) => {
    setExperimentBusy(true);
    setExperimentError(null);
    try {
      await useExperimental.getState().setMaster(next);
    } catch (cause) {
      setExperimentError(cause instanceof Error ? cause.message : '试验功能设置保存失败，请重试。');
    } finally {
      setExperimentBusy(false);
    }
  };

  const toggleClassroom = async (next: boolean) => {
    setClassroomBusy(true);
    setExperimentError(null);
    try {
      await useExperimental.getState().setClassroom(next);
    } catch (cause) {
      setExperimentError(cause instanceof Error ? cause.message : '课堂视频设置保存失败，请重试。');
    } finally {
      setClassroomBusy(false);
    }
  };

  useEffect(() => {
    void loadExperiments();
  }, [loadExperiments]);

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
            <p className="text-[12px] text-ink-3">允许使用试验阶段的功能；关闭时隐藏全部子项。</p>
          </div>
          <Switch
            label="试验功能"
            checked={master ?? false}
            disabled={master === null || experimentBusy}
            onChange={(next) => void toggleExperiments(next)}
          />
        </div>
        {master && (
          // 子项管理：随总开关展开，左侧 hairline 表达从属层级。
          <div className="ml-1 grid gap-0.5 border-l border-line pl-4">
            <div
              className="flex items-center justify-between gap-3 py-2"
              data-setting-id="experimental-classroom"
            >
              <div className="grid gap-1">
                <h3 className="text-[13px] font-medium">课堂视频</h3>
                <p className="text-[12px] text-ink-3">在线观看交大课堂录像并下载。</p>
              </div>
              <Switch
                label="课堂视频"
                checked={classroom}
                disabled={classroomBusy}
                onChange={(next) => void toggleClassroom(next)}
              />
            </div>
          </div>
        )}
        {experimentError && (
          <p className="text-[12px] text-red" role="alert">
            {experimentError}
          </p>
        )}
      </section>
    </div>
  );
}
