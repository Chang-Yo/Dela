import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  fontScaleLevels,
  zoomLevels,
  type FontScalePreference,
  type IconPreference,
  type ThemePreference,
  type ZoomPreference,
} from '../../../../shared/api';
import { cn } from '../../../lib/utils';
import { StepperControl } from '../../../components/ui/stepper';
import blackLogo from '../../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../../assets/Dela_white_bg.svg';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';

const themes: Array<{ id: ThemePreference; label: string; preview: string }> = [
  {
    id: 'system',
    label: '跟随系统',
    preview: 'bg-linear-to-br from-neutral-100 from-50% to-neutral-700 to-50%',
  },
  { id: 'light', label: '浅色', preview: 'bg-neutral-100' },
  { id: 'dark', label: '深色', preview: 'bg-neutral-800' },
];

const icons: Array<{ id: IconPreference; label: string; src: string }> = [
  { id: 'white', label: '白底', src: whiteLogo },
  { id: 'black', label: '黑底', src: blackLogo },
];

// 缩放档位标签直接由档位值换算为百分比，与系统显示缩放的写法一致。
const zoomLabel = (zoom: ZoomPreference) => `${Math.round(zoom * 100)}%`;

const fontScaleLabels: Record<FontScalePreference, string> = {
  0.9: '小',
  1: '默认',
  1.1: '大',
  1.25: '特大',
};

// 每个外观选项（主题/图标/缩放/字号）独立的写入状态：互不阻塞，失败提示各归其位。
function useOptionSave(failMessage: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError(failMessage);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

export function AppearanceSection({
  fontScale,
  onFontScaleChange,
  onThemeChange,
  onZoomChange,
  theme,
  zoom,
}: {
  fontScale: FontScalePreference;
  onFontScaleChange: (scale: FontScalePreference) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
}) {
  const [icon, setIcon] = useState<IconPreference>('white');
  const themeSave = useOptionSave('主题保存失败，请重试。');
  const iconSave = useOptionSave('图标设置保存失败，请重试。');
  const zoomSave = useOptionSave('缩放设置保存失败，请重试。');
  const fontSave = useOptionSave('字号保存失败，请重试。');

  useEffect(() => {
    void window.dela?.settings
      .getIcon()
      .then(setIcon)
      .catch(() => {});
  }, []);

  const selectTheme = (next: ThemePreference) => {
    if (next === theme || themeSave.busy) return;
    void themeSave.save(() => onThemeChange(next));
  };

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const selectIcon = (next: IconPreference) => {
    if (next === icon || iconSave.busy) return;
    void iconSave.save(async () => {
      setIcon(window.dela ? await window.dela.settings.setIcon(next) : next);
    });
  };

  const selectZoom = (next: ZoomPreference) => {
    if (next === zoom || zoomSave.busy) return;
    void zoomSave.save(() => onZoomChange(next));
  };

  const selectFontScale = (next: FontScalePreference) => {
    if (next === fontScale || fontSave.busy) return;
    void fontSave.save(() => onFontScaleChange(next));
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="外观" />
      {/* 四个设置项一行一项：标签贴左、控件右对齐同一竖线，行间分隔线承担边界。 */}
      <section className="grid">
        <SettingRow settingId="theme" title="主题">
          <div aria-label="主题" className="flex flex-wrap items-center gap-2" role="group">
            {themes.map(({ id, label, preview }) => (
              <button
                aria-pressed={theme === id}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-card border border-line px-3 text-[12px] transition-colors',
                  theme === id
                    ? 'border-foreground/60 bg-inset font-medium text-ink'
                    : 'border-line text-ink-3 hover:bg-inset hover:text-ink',
                )}
                disabled={themeSave.busy}
                key={id}
                onClick={() => selectTheme(id)}
                type="button"
              >
                <span className={cn('size-4 rounded border border-line', preview)} />
                {label}
                {theme === id ? <Check className="size-3.5" strokeWidth={2} /> : null}
              </button>
            ))}
          </div>
          {themeSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {themeSave.error}
            </p>
          )}
        </SettingRow>
        <SettingRow settingId="zoom" title="页面缩放">
          <StepperControl
            canDecrease={zoom > zoomLevels[0]}
            canIncrease={zoom < zoomLevels.at(-1)!}
            display={zoomLabel(zoom)}
            label="页面缩放"
            onStep={(delta) => {
              const next = zoomLevels[zoomLevels.indexOf(zoom) + delta];
              if (next) selectZoom(next);
            }}
          />
          {zoomSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {zoomSave.error}
            </p>
          )}
        </SettingRow>
        <SettingRow settingId="font-scale" title="字号">
          <StepperControl
            canDecrease={fontScale > fontScaleLevels[0]}
            canIncrease={fontScale < fontScaleLevels.at(-1)!}
            display={fontScaleLabels[fontScale]}
            label="字号"
            onStep={(delta) => {
              const next = fontScaleLevels[fontScaleLevels.indexOf(fontScale) + delta];
              if (next) selectFontScale(next);
            }}
          />
          {fontSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {fontSave.error}
            </p>
          )}
        </SettingRow>
        <SettingRow description="重启应用后生效。" settingId="icon" title="应用图标">
          <div aria-label="应用图标" className="flex flex-wrap items-center gap-2" role="group">
            {icons.map(({ id, label, src }) => (
              <button
                aria-label={label}
                aria-pressed={icon === id}
                className={cn(
                  'relative rounded-card border border-line p-2 transition-colors',
                  icon === id ? 'border-foreground/60 bg-inset' : 'border-line hover:bg-inset',
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
          {iconSave.error && (
            <p className="text-[12px] text-red" role="alert">
              {iconSave.error}
            </p>
          )}
        </SettingRow>
      </section>
    </div>
  );
}
