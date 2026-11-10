import { Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { navEntries, useNavEntryPrefs } from '../../../navigation/entries';
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
  const hiddenEntries = useNavEntryPrefs((state) => state.hidden);
  const setEntryVisible = useNavEntryPrefs((state) => state.setVisible);
  // 空串 = 跟随系统默认；读失败保持空串不打扰用户。
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

  useEffect(() => {
    void window.dela?.vsjtu
      .getDownloadDirectory()
      .then(setDownloadDirectory)
      .catch(() => {});
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
          {navEntries.map((entry) => (
            <SettingRow key={entry.id} settingId={`nav-entry-${entry.id}`} title={entry.label}>
              <Switch
                checked={!hiddenEntries.includes(entry.id)}
                label={`在导航中显示${entry.label}`}
                onChange={(next) => setEntryVisible(entry.id, next)}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
      </div>
      <SystemNotifications />
      <UpdateControl />
      <div className="grid gap-2">
        <SettingsGroup title="课堂视频">
          <SettingRow
            description="下载课堂录像的默认保存位置；每次下载仍可在保存对话框里改。"
            settingId="video-download-directory"
            title="视频默认下载目录"
          >
            <div className="flex items-center justify-end gap-3">
              <span className="truncate text-xs text-ink-3" title={downloadDirectory || undefined}>
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
        </SettingsGroup>
      </div>
      <CacheUsage />
    </div>
  );
}
