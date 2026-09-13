import { useEffect, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { IconPreference, ThemePreference } from '../../../shared/api';
import { cn } from '../../lib/utils';
import blackLogo from '../../../../assets/Dela_black_bg.svg';
import whiteLogo from '../../../../assets/Dela_white_bg.svg';
import { SectionHeader } from './SectionHeader';

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

export function AppearanceSection({
  onThemeChange,
  theme,
}: {
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  theme: ThemePreference;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icon, setIcon] = useState<IconPreference>('white');
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.settings
      .getIcon()
      .then(setIcon)
      .catch(() => {});
  }, []);

  const selectTheme = async (next: ThemePreference) => {
    if (next === theme || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onThemeChange(next);
    } catch {
      setError('主题保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const selectIcon = async (next: IconPreference) => {
    if (next === icon || iconBusy) return;
    setIconBusy(true);
    setIconError(null);
    try {
      setIcon(window.dela ? await window.dela.settings.setIcon(next) : next);
    } catch {
      setIconError('图标设置保存失败，请重试。');
    } finally {
      setIconBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <SectionHeader description="主题立即应用；应用图标在重启应用后生效。" title="外观" />
      <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">主题</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            跟随系统自动切换，或固定为浅色/深色。
          </p>
        </div>
        <div aria-label="主题" className="flex flex-wrap gap-3" role="radiogroup">
          {themes.map(({ id, label, preview }) => (
            <OptionCard
              busy={busy}
              key={id}
              label={label}
              onSelect={() => void selectTheme(id)}
              selected={theme === id}
            >
              <span className={cn('h-14 rounded-md border border-black/10', preview)} />
            </OptionCard>
          ))}
        </div>
        {error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">应用图标</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            应用窗口与任务栏图标的底色，重启应用后生效。
          </p>
        </div>
        <div aria-label="应用图标" className="flex flex-wrap gap-3" role="radiogroup">
          {icons.map(({ id, label, src }) => (
            <OptionCard
              busy={iconBusy}
              key={id}
              label={label}
              onSelect={() => void selectIcon(id)}
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
        {iconError && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {iconError}
          </p>
        )}
      </section>
    </div>
  );
}
