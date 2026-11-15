import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../../ui/switch';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { showToast } from '../../../ui/toast';
import { UpdateControl } from '../../update/view';
import { errorMessage } from '../../../core/protocol/contract';

export function GeneralSection({ navEntries }: { navEntries: ReactNode }) {
  const queryClient = useQueryClient();
  // 未读到当前状态（data 为 undefined）时开关保持禁用，避免闪烁出错误的默认值。
  const openAtLogin = useQuery({
    queryKey: ['settings', 'openAtLogin'],
    queryFn: () => settingsClient.openAtLogin().catch(() => false),
    enabled: Boolean(window.dela),
  }).data;
  const [busy, setBusy] = useState(false);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化并同步系统启动项。
  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      queryClient.setQueryData(
        ['settings', 'openAtLogin'],
        window.dela ? await settingsClient.setOpenAtLogin(next) : next,
      );
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
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
              disabled={openAtLogin === undefined || busy}
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
