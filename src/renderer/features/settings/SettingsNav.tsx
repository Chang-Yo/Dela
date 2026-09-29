import {
  Bell,
  Bot,
  Info,
  LayoutGrid,
  Palette,
  Plug,
  Puzzle,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsSectionId } from '../../../shared/settings';
import { cn } from '../../lib/utils';
import { settingsSectionLabels } from './search-index';

export type { SettingsSectionId };

const sections: Array<{ id: SettingsSectionId; icon: LucideIcon }> = [
  { id: 'general', icon: SlidersHorizontal },
  { id: 'appearance', icon: Palette },
  { id: 'notifications', icon: Bell },
  { id: 'workspace', icon: LayoutGrid },
  { id: 'llm', icon: Bot },
  { id: 'connections', icon: Plug },
  { id: 'plugins', icon: Puzzle },
  { id: 'about', icon: Info },
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
      {sections.map(({ id, icon: Icon }) => {
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
            <span className="truncate">{settingsSectionLabels[id]}</span>
          </button>
        );
      })}
    </nav>
  );
}
