import { Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { useExperimental } from '../experimental';
import { navEntries, useNavEntryAvailable, useNavEntryPrefs } from '../../../navigation/entries';
import type { ExperimentKey } from '../../../../shared/api';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { SystemNotifications } from './SystemNotifications';
import { CacheUsage } from './CacheUsage';
import { UpdateControl } from '../UpdateControl';

export function GeneralSection() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const experiments = useExperimental((state) => state.state);
  const loadExperiments = useExperimental((state) => state.load);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const hiddenEntries = useNavEntryPrefs((state) => state.hidden);
  const setEntryVisible = useNavEntryPrefs((state) => state.setVisible);
  const entryAvailable = useNavEntryAvailable();
  // 空串 = 跟随系统默认；只在课堂视频开着时读，读失败保持空串不打扰用户。
  const [downloadDirectory, setDownloadDirectory] = useState('');
  const [directoryBusy, setDirectoryBusy] = useState(false);

  const chooseDownloadDirectory = async () => {
    if (directoryBusy) return;
    setDirectoryBusy(true);
    try {
      const next = await window.dela?.vsjtu.chooseDownloadDirectory();
      if (next !== undefined) setDownloadDirectory(next);
    } catch (cause) {
      showToast({ variant: 'error', title: '选择目录失败', description: errorText(cause) });
    } finally {
      setDirectoryBusy(false);
    }
  };

  const toggleExperiment = async (key: ExperimentKey, next: boolean) => {
    setExperimentBusy(true);
    try {
      await useExperimental.getState().set(key, next);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setExperimentBusy(false);
    }
  };

  useEffect(() => {
    void loadExperiments();
  }, [loadExperiments]);

  const master = experiments?.master ?? false;
  // 目录行只在课堂视频下载开着时出现，跟着它读一次，不用常驻状态。
  const directoryVisible = master && Boolean(experiments?.videoDownload);
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
      .catch(() => setOpenAtLogin(false));
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化并同步系统启动项。
  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      setOpenAtLogin(window.dela ? await window.dela.settings.setOpenAtLogin(next) : next);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
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
              checked={openAtLogin ?? false}
              disabled={openAtLogin === null || busy}
              label="开机自启动"
              onChange={(next) => void toggleOpenAtLogin(next)}
            />
          </SettingRow>
        </SettingsGroup>
      </div>
      <div className="grid gap-2">
        <SettingsGroup settingId="nav-entries" title="导航入口">
          {navEntries.map((entry) => {
            const available = entryAvailable(entry.id);
            return (
              <SettingRow
                description={available ? undefined : '功能已关闭'}
                key={entry.id}
                settingId={`nav-entry-${entry.id}`}
                title={entry.label}
              >
                <Switch
                  checked={available && !hiddenEntries.includes(entry.id)}
                  disabled={!available}
                  label={`在导航中显示${entry.label}`}
                  onChange={(next) => setEntryVisible(entry.id, next)}
                />
              </SettingRow>
            );
          })}
        </SettingsGroup>
      </div>
      <SystemNotifications />
      <UpdateControl />
      <div className="grid gap-2">
        {/* 有主语开关的组：从属子项靠缩进表达层级。 */}
        <SettingsGroup settingId="experimental-features">
          <SettingRow
            description="允许使用试验阶段的功能；关闭时全部子项停用。"
            settingId="experimental-master"
            title="试验功能"
          >
            <Switch
              checked={master}
              disabled={experiments === null || experimentBusy}
              label="试验功能"
              onChange={(next) => void toggleExperiment('master', next)}
            />
          </SettingRow>
          {master && (
            <SettingRow
              description="浏览、搜索与回复水源社区；关闭后入口、相关 Skill 与通知一并停用，绑定的账号保留。"
              nested
              settingId="experimental-shuiyuan"
              title="水源社区"
            >
              <Switch
                checked={experiments?.shuiyuan ?? false}
                disabled={experimentBusy}
                label="水源社区"
                onChange={(next) => void toggleExperiment('shuiyuan', next)}
              />
            </SettingRow>
          )}
          {master && (
            <SettingRow
              description="在课堂视频页下载录像；关闭时进行中的下载立即取消。"
              nested
              settingId="experimental-video-download"
              title="课堂视频下载"
            >
              <Switch
                checked={experiments?.videoDownload ?? false}
                disabled={experimentBusy}
                label="课堂视频下载"
                onChange={(next) => void toggleExperiment('videoDownload', next)}
              />
            </SettingRow>
          )}
          {directoryVisible && (
            <SettingRow
              description="下载课堂录像的默认保存位置；每次下载仍可在保存对话框里改。"
              nested
              settingId="experimental-download-directory"
              title="视频默认下载目录"
            >
              <div className="flex items-center justify-end gap-3">
                <span
                  className="truncate text-xs text-ink-3"
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
      </div>
      <CacheUsage />
    </div>
  );
}
