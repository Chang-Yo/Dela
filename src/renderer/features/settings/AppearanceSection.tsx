import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ThemePreference } from '../../../shared/api';
import { cn } from '../../lib/utils';
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

export function AppearanceSection({
  onThemeChange,
  theme,
}: {
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  theme: ThemePreference;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="grid gap-5">
      <SectionHeader description="选择会立即应用，并在下次启动时保留。" title="外观" />
      <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">主题</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            跟随系统自动切换，或固定为浅色/深色。
          </p>
        </div>
        <div aria-label="主题" className="flex flex-wrap gap-3" role="radiogroup">
          {themes.map(({ id, label, preview }) => {
            const selected = theme === id;
            return (
              <button
                aria-checked={selected}
                className={cn(
                  'grid w-[120px] gap-2 rounded-lg border p-2 text-left transition-colors',
                  selected ? 'border-foreground/60 bg-muted/50' : 'border-border hover:bg-muted/50',
                )}
                key={id}
                disabled={busy}
                onClick={() => void selectTheme(id)}
                role="radio"
                type="button"
              >
                <span className={cn('h-14 rounded-md border border-black/10', preview)} />
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
          })}
        </div>
        {error && (
          <p className="col-span-full text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
