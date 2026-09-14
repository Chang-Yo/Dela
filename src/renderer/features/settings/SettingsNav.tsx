import { Bot, Info, Palette, Plug, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type SettingsSectionId = 'connections' | 'llm' | 'appearance' | 'about';

const sections: Array<{ id: SettingsSectionId; label: string; icon: LucideIcon }> = [
  { id: 'connections', label: '数据与服务', icon: Plug },
  { id: 'llm', label: '模型服务', icon: Bot },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'about', label: '关于', icon: Info },
];

type SettingsNavProps = {
  value: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
};

/** 宽屏为左侧纵列，窄屏为顶部横向分区行。 */
export function SettingsNav({ value, onSectionChange }: SettingsNavProps) {
  return (
    <nav
      aria-label="设置分区"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/40 p-2 md:w-[200px] md:flex-col md:overflow-y-auto md:border-b-0 md:border-r"
    >
      <span className="hidden h-8 items-center px-2 text-xs font-medium text-muted-foreground md:flex">
        设置
      </span>
      {sections.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
              active
                ? 'bg-background font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
            key={id}
            onClick={() => onSectionChange(id)}
            type="button"
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
