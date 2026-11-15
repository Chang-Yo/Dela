import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../ui/button';
import { formatBytes } from '../../../ui/format-bytes';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { showToast } from '../../../renderer/app/toasts';
import { errorMessage } from '../../../core/protocol/contract';

/**
 * 通用 › 缓存占用：占用量跟在标题后面（Chromium 的可再生缓存，本机实测数百 MB），右侧只放动作。
 * 缓存目录多达成千上万个小文件，量一次要扫盘，所以量完之前不显示数字也不让点。
 */
export function CacheUsage() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // 量不出来就保持「正在计算」，用户仍可点清除（清理本身不依赖这个数）。
  const size = useQuery({
    queryKey: ['settings', 'cacheSize'],
    queryFn: () => settingsClient.cacheSize(),
    enabled: Boolean(window.dela),
    retry: false,
  });
  const bytes = size.data ?? null;

  const clear = async () => {
    if (!window.dela || busy) return;
    setBusy(true);
    try {
      const result = await settingsClient.clearCache();
      setConfirming(false);
      void size.refetch();
      const freed = formatBytes(result.freed);
      showToast({
        variant: 'success',
        title: freed ? `已清除 ${freed}` : '没有可清除的缓存',
        // 删不掉的文件是这台机器当时的状态，说明白比假装清干净好。
        description: result.blocked ? '部分文件正被占用，重启应用后可再清除。' : undefined,
      });
    } catch (cause) {
      showToast({ variant: 'error', title: '清除缓存失败', description: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup settingId="cache-usage">
      <SettingRow
        settingId="cache-usage"
        title={
          <span className="flex items-baseline gap-2">
            缓存占用{' '}
            <span className="text-xs font-normal tabular-nums text-ink-3">
              {bytes === null ? '正在计算…' : (formatBytes(bytes) ?? '0 B')}
            </span>
          </span>
        }
      >
        {confirming ? (
          <div className="flex items-center gap-2">
            <Button disabled={busy} onClick={() => void clear()} size="sm" variant="destructive">
              {busy ? '清除中…' : '确认清除'}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)} size="sm" variant="ghost">
              取消
            </Button>
          </div>
        ) : (
          <Button
            disabled={busy || bytes === null || !window.dela}
            onClick={() => setConfirming(true)}
            size="sm"
            variant="secondary"
          >
            <Trash2 />
            清除缓存
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  );
}
