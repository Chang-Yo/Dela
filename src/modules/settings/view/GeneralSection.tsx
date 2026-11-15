import { useEffect, useState, type ReactNode } from 'react';
import { Switch } from '../../../ui/switch';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { errorText } from '../../../renderer/workspace/store';
import { showToast } from '../../../renderer/app/toasts';
import { UpdateControl } from '../../update/view';

export function GeneralSection({ navEntries }: { navEntries: ReactNode }) {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.dela) return;
    void settingsClient
      .openAtLogin()
      .then(setOpenAtLogin)
      .catch(() => setOpenAtLogin(false));
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化并同步系统启动项。
  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      setOpenAtLogin(window.dela ? await settingsClient.setOpenAtLogin(next) : next);
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
      {navEntries}
      <UpdateControl />
    </div>
  );
}
