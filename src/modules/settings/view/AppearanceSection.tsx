import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import {
  fontSizeMax,
  fontSizeMin,
  zoomLevels,
  type IconPreference,
  type ThemePreference,
  type ZoomPreference,
} from '../contract';
import { cn } from '../../../ui/lib/cn';
import { Stepper } from '../../../ui/stepper';
import blackLogo from '../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { SectionHeader } from './SectionHeader';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { showToast } from '../../../ui/toast';
import { errorMessage } from '../../../core/protocol/contract';

const themes: Array<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'system', label: '跟随系统' },
  { id: 'dark', label: '深色' },
];

const icons: Array<{ id: IconPreference; label: string; src: string }> = [
  { id: 'white', label: '白底', src: whiteLogo },
  { id: 'black', label: '黑底', src: blackLogo },
];

const zoomLabel = (zoom: ZoomPreference) => `${Math.round(zoom * 100)}%`;

/** 主题卡片缩略图：靠 `theme-light` / `dark` 把卡片单独切到对应主题；「跟随系统」左右各半。 */
function ThemePreview({ mode }: { mode: ThemePreference }) {
  const bars = (
    <>
      <span className="h-2 w-[70%] rounded-full bg-ink" />
      <span className="h-2 w-[46%] rounded-full bg-accent" />
      <span className="h-2 w-[58%] rounded-full bg-ink-3" />
    </>
  );
  if (mode === 'system') {
    return (
      <div className="grid grid-cols-2 overflow-hidden rounded-control shadow-hairline">
        <div className="theme-light grid content-center gap-2 bg-surface px-3 py-4">{bars}</div>
        <div className="dark grid content-center gap-2 bg-surface px-3 py-4">{bars}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'grid content-center gap-2 rounded-control bg-surface px-3 py-4 shadow-hairline',
        mode === 'dark' ? 'dark' : 'theme-light',
      )}
    >
      {bars}
    </div>
  );
}

function useOptionSave() {
  const [busy, setBusy] = useState(false);
  const save = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };
  return { busy, save };
}

export function AppearanceSection({
  fontSize,
  onFontSizeChange,
  onThemeChange,
  onZoomChange,
  theme,
  zoom,
}: {
  fontSize: number;
  onFontSizeChange: (size: number) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
}) {
  const queryClient = useQueryClient();
  const icon =
    useQuery({
      queryKey: ['settings', 'icon'],
      queryFn: () => settingsClient.icon(),
      enabled: Boolean(window.dela),
    }).data ?? 'white';
  const themeSave = useOptionSave();
  const iconSave = useOptionSave();
  const zoomSave = useOptionSave();
  const fontSave = useOptionSave();

  const selectTheme = (next: ThemePreference) => {
    if (next === theme || themeSave.busy) return;
    void themeSave.save(() => onThemeChange(next));
  };

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const selectIcon = (next: IconPreference) => {
    if (next === icon || iconSave.busy) return;
    void iconSave.save(async () => {
      queryClient.setQueryData(
        ['settings', 'icon'],
        window.dela ? await settingsClient.setIcon(next) : next,
      );
    });
  };

  const selectZoom = (next: ZoomPreference) => {
    if (next === zoom || zoomSave.busy) return;
    void zoomSave.save(() => onZoomChange(next));
  };

  const selectFontSize = (next: number) => {
    if (next === fontSize || fontSave.busy) return;
    void fontSave.save(() => onFontSizeChange(next));
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="外观" />
      <SettingsGroup>
        <div className="grid gap-3 border-b border-line py-3.5" data-setting-id="theme">
          <h3 className="text-sm font-medium text-ink">主题</h3>
          <div aria-label="主题" className="grid grid-cols-3 gap-2" role="group">
            {themes.map(({ id, label }) => (
              <button
                aria-pressed={theme === id}
                className={cn(
                  'relative grid content-start gap-2 rounded-card border p-2 transition-colors',
                  theme === id ? 'border-ink' : 'border-line hover:border-line-strong',
                )}
                disabled={themeSave.busy}
                key={id}
                onClick={() => selectTheme(id)}
                type="button"
              >
                <ThemePreview mode={id} />
                {theme === id ? (
                  <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-ink text-surface">
                    <Check className="size-2.5" strokeWidth={2.5} />
                  </span>
                ) : null}
                <span
                  className={cn(
                    'text-center text-xs',
                    theme === id ? 'font-medium text-ink' : 'text-ink-3',
                  )}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
        <SettingRow settingId="zoom" title="页面缩放">
          <Stepper
            canDecrease={zoom > zoomLevels[0]}
            canIncrease={zoom < zoomLevels.at(-1)!}
            display={zoomLabel(zoom)}
            label="页面缩放"
            onStep={(delta) => {
              const next = zoomLevels[zoomLevels.indexOf(zoom) + delta];
              if (next) selectZoom(next);
            }}
          />
        </SettingRow>
        <SettingRow settingId="font-size" title="字号">
          <Stepper
            canDecrease={fontSize > fontSizeMin}
            canIncrease={fontSize < fontSizeMax}
            display={`${fontSize}px`}
            input={{
              min: fontSizeMin,
              max: fontSizeMax,
              unit: 'px',
              value: fontSize,
              onValueChange: selectFontSize,
            }}
            label="字号"
            onStep={(delta) => selectFontSize(fontSize + delta)}
          />
        </SettingRow>
        <SettingRow description="重启应用后生效。" settingId="icon" title="应用图标">
          <div aria-label="应用图标" className="flex flex-wrap items-center gap-2" role="group">
            {icons.map(({ id, label, src }) => (
              <button
                aria-label={label}
                aria-pressed={icon === id}
                className={cn(
                  'relative rounded-card border border-line p-2 transition-colors',
                  icon === id ? 'border-ink bg-hover' : 'border-line hover:bg-hover',
                )}
                disabled={iconSave.busy}
                key={id}
                onClick={() => selectIcon(id)}
                title={label}
                type="button"
              >
                <img alt="" className="size-12 rounded-control border border-line" src={src} />
                {icon === id ? (
                  <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-ink text-surface">
                    <Check className="size-2.5" strokeWidth={2.5} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
