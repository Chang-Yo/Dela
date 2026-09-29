import { useEffect, useState, type ReactNode } from 'react';
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
import blackLogo from '../../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../../assets/Dela_white_bg.svg';
import { SectionHeader } from '../SectionHeader';

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
const zoomOptions: Array<{ id: ZoomPreference; label: string }> = zoomLevels.map((zoom) => ({
  id: zoom,
  label: `${Math.round(zoom * 100)}%`,
}));

const fontScaleLabels: Record<FontScalePreference, string> = {
  0.9: '小',
  1: '默认',
  1.1: '大',
  1.25: '特大',
};

function OptionCard({
  busy,
  children,
  label,
  onSelect,
  selected,
}: {
  busy: boolean;
  children: ReactNode;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-checked={selected}
      className={cn(
        'grid w-[120px] gap-2 rounded-lg border p-2 text-left transition-colors',
        selected ? 'border-foreground/60 bg-muted/50' : 'border-border hover:bg-muted/50',
      )}
      disabled={busy}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      {children}
      <span
        className={cn(
          'flex items-center gap-1 text-xs',
          selected ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {selected ? <Check className="size-3.5" strokeWidth={2} /> : null}
        {label}
      </span>
    </button>
  );
}

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
    <div className="grid gap-5">
      <SectionHeader description="主题立即应用；应用图标在重启应用后生效。" title="外观" />
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="theme"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">主题</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            跟随系统自动切换，或固定为浅色/深色。
          </p>
        </div>
        <div aria-label="主题" className="flex flex-wrap gap-3" role="radiogroup">
          {themes.map(({ id, label, preview }) => (
            <OptionCard
              busy={themeSave.busy}
              key={id}
              label={label}
              onSelect={() => selectTheme(id)}
              selected={theme === id}
            >
              <span className={cn('h-14 rounded-md border border-black/10', preview)} />
            </OptionCard>
          ))}
        </div>
        {themeSave.error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {themeSave.error}
          </p>
        )}
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="zoom"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">页面缩放</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            整个界面按比例缩放，立即生效并持久保存；快捷键 Ctrl/⌘ + 放大、- 缩小、0 重置。
          </p>
        </div>
        <div className="flex items-center justify-end">
          {/* 固定宽度（w-24，6rem/96px）避免选项长短不一导致切换时宽度跳动。 */}
          <select
            aria-label="页面缩放"
            className="h-9 w-24 rounded-md border bg-background px-3 text-sm text-foreground"
            disabled={zoomSave.busy}
            onChange={(event) => selectZoom(Number(event.target.value) as ZoomPreference)}
            value={zoom}
          >
            {zoomOptions.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {zoomSave.error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {zoomSave.error}
          </p>
        )}
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="font-scale"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">字号</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            调整界面文字大小，不影响间距与图标。
          </p>
        </div>
        <div className="flex items-center justify-end">
          {/* 固定宽度（w-24，6rem/96px）避免选项长短不一导致切换时宽度跳动。 */}
          <select
            aria-label="字号"
            className="h-9 w-24 rounded-md border bg-background px-3 text-sm text-foreground"
            disabled={fontSave.busy}
            onChange={(event) => selectFontScale(Number(event.target.value) as FontScalePreference)}
            value={fontScale}
          >
            {fontScaleLevels.map((level) => (
              <option key={level} value={level}>
                {fontScaleLabels[level]}
              </option>
            ))}
          </select>
        </div>
        {fontSave.error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {fontSave.error}
          </p>
        )}
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="icon"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">应用图标</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            应用窗口与任务栏图标的底色，重启应用后生效。
          </p>
        </div>
        <div aria-label="应用图标" className="flex flex-wrap gap-3" role="radiogroup">
          {icons.map(({ id, label, src }) => (
            <OptionCard
              busy={iconSave.busy}
              key={id}
              label={label}
              onSelect={() => selectIcon(id)}
              selected={icon === id}
            >
              <img
                alt=""
                className="h-14 w-14 justify-self-center rounded-md border border-black/10"
                src={src}
              />
            </OptionCard>
          ))}
        </div>
        {iconSave.error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {iconSave.error}
          </p>
        )}
      </section>
    </div>
  );
}
