import { Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { useExperimental } from '../experimental';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
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
  // 空串 = 跟随系统默认；只在课堂视频开着时读，读失败保持空串不打扰用户。
  const [downloadDirectory, setDownloadDirectory] = useState('');
  const [directoryBusy, setDirectoryBusy] = useState(false);

  const chooseDownloadDirectory = async () => {
    if (directoryBusy) return;
    setDirectoryBusy(true);
    setExperimentError(null);
    try {
      const next = await window.dela?.vsjtu.chooseDownloadDirectory();
      if (next !== undefined) setDownloadDirectory(next);
    } catch {
      setExperimentError('下载目录设置保存失败，请重试。');
    } finally {
      setDirectoryBusy(false);
    }
  };

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

  // 目录行只在课堂视频开着时出现，跟着它读一次，不用常驻状态。
  const directoryVisible = master === true && classroom;
  useEffect(() => {
    if (!directoryVisible) return;
    void window.dela?.vsjtu
      .getDownloadDirectory()
      .then(setDownloadDirectory)
      .catch(() => {});
  }, [directoryVisible]);

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
      <div className="grid gap-2">
        <SettingsGroup title="启动">
          <SettingRow settingId="open-at-login" title="开机自启动">
            <Switch
              checked={openAtLogin ?? true}
              disabled={openAtLogin === null || busy}
              label="开机自启动"
              onChange={(next) => void toggleOpenAtLogin(next)}
            />
          </SettingRow>
        </SettingsGroup>
        {error && (
          <p className="text-[12px] text-red" role="alert">
            {error}
          </p>
        )}
      </div>
      <SystemNotifications />
      <div className="grid gap-2">
        {/* 有主语开关的组：标题做成容器内第一行，从属子项跟在后面（靠缩进表达层级，不再画竖线）。 */}
        <SettingsGroup settingId="experimental-features">
          <SettingRow
            description="允许使用试验阶段的功能；关闭时隐藏全部子项。"
            settingId="experimental-master"
            title="试验功能"
          >
            <Switch
              checked={master ?? false}
              disabled={master === null || experimentBusy}
              label="试验功能"
              onChange={(next) => void toggleExperiments(next)}
            />
          </SettingRow>
          {master && (
            <SettingRow
              description="在线观看交大课堂录像并下载。"
              nested
              settingId="experimental-classroom"
              title="课堂视频"
            >
              <Switch
                checked={classroom}
                disabled={classroomBusy}
                label="课堂视频"
                onChange={(next) => void toggleClassroom(next)}
              />
            </SettingRow>
          )}
          {master && classroom && (
            <SettingRow
              description="下载课堂录像的默认保存位置；每次下载仍可在保存对话框里改。"
              nested
              settingId="experimental-download-directory"
              title="视频默认下载目录"
            >
              <div className="flex items-center justify-end gap-3">
                <span
                  className="truncate text-[12px] text-ink-3"
                  title={downloadDirectory || undefined}
                >
                  {downloadDirectory || '跟随系统默认'}
                </span>
                <Button
                  disabled={directoryBusy}
                  onClick={() => void chooseDownloadDirectory()}
                  size="sm"
                  variant="secondary"
                >
                  <Folder />
                  选择
                </Button>
              </div>
            </SettingRow>
          )}
        </SettingsGroup>
        {experimentError && (
          <p className="text-[12px] text-red" role="alert">
            {experimentError}
          </p>
        )}
      </div>
    </div>
  );
}
