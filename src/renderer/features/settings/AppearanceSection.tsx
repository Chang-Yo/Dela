import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SectionHeader } from './SectionHeader';

type ThemeId = 'system' | 'light' | 'dark';

// 主题选择当前只维护组件内选择态，不持久化、也不实际切换主题；
// 待接入的接口与 renderer 改动记录在同目录 INTERFACES.md。
const themes: Array<{ id: ThemeId; label: string; preview: string }> = [
  {
    id: 'system',
    label: '跟随系统',
    preview: 'bg-linear-to-br from-neutral-100 from-50% to-neutral-700 to-50%',
  },
  { id: 'light', label: '浅色', preview: 'bg-neutral-100' },
  { id: 'dark', label: '深色', preview: 'bg-neutral-800' },
];

export function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeId>('system');

  return (
    <div className="grid gap-5">
      <SectionHeader description="界面明暗主题，选择尚未实际应用。" title="外观" />
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
                onClick={() => setTheme(id)}
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
      </section>
    </div>
  );
}
