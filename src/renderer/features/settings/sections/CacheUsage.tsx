import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { formatBytes } from '../../classroom/player-format';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';

/**
 * 通用 › 缓存占用：占用量跟在标题后面（Chromium 的可再生缓存，本机实测数百 MB），右侧只放动作。
 * 缓存目录多达成千上万个小文件，量一次要扫盘，所以量完之前不显示数字也不让点。
 */
export function CacheUsage() {
  const [bytes, setBytes] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const dela = window.dela;
    if (!dela) return;
    try {
      setBytes(await dela.cache.getSize());
    } catch {
      // 量不出来就保持「正在计算」，用户仍可点清除（清理本身不依赖这个数）。
      setBytes(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async () => {
    const dela = window.dela;
    if (!dela || busy) return;
    setBusy(true);
    try {
      const result = await dela.cache.clear();
      setConfirming(false);
      void refresh();
      const freed = formatBytes(result.freed);
      showToast({
        variant: 'success',
        title: freed ? `已清除 ${freed}` : '没有可清除的缓存',
        // 删不掉的文件是这台机器当时的状态，说明白比假装清干净好。
        description: result.blocked ? '部分文件正被占用，重启应用后可再清除。' : undefined,
      });
    } catch (cause) {
      showToast({ variant: 'error', title: '清除缓存失败', description: errorText(cause) });
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
