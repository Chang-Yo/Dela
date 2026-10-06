import {
  Archive,
  Blocks,
  Bot,
  Info,
  Keyboard,
  LayoutGrid,
  Palette,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsSectionId } from '../../../shared/settings';
import { cn } from '../../lib/utils';
import { settingsSectionLabels } from './search-index';

export type { SettingsSectionId };

/** 分区目录：group 为侧栏分组标题（设置内只有一层分类，分组仅作视觉归拢）。 */
const sections: Array<{ id: SettingsSectionId; group: string; icon: LucideIcon }> = [
  { id: 'general', group: '基本', icon: SlidersHorizontal },
  { id: 'appearance', group: '基本', icon: Palette },
  { id: 'shortcuts', group: '基本', icon: Keyboard },
  { id: 'workspace', group: '数据', icon: LayoutGrid },
  { id: 'archived', group: '数据', icon: Archive },
  { id: 'connections', group: '数据', icon: Plug },
  { id: 'providers', group: '模型', icon: Bot },
  { id: 'capabilities', group: '模型', icon: Blocks },
  { id: 'commands', group: '模型', icon: Terminal },
  { id: 'skills', group: '模型', icon: Sparkles },
  { id: 'mcp', group: '模型', icon: Server },
  { id: 'about', group: '关于', icon: Info },
  { id: 'privacy', group: '关于', icon: ShieldCheck },
];

/** 按分组切分目录，保持目录顺序。 */
const sectionGroups = sections.reduce<Array<{ title: string; items: typeof sections }>>(
  (groups, section) => {
    const last = groups.at(-1);
    if (last && last.title === section.group) last.items.push(section);
    else groups.push({ title: section.group, items: [section] });
    return groups;
  },
  [],
);

type SettingsNavProps = {
  value: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
};

/** 宽屏为左侧纵列（带分组标题），窄屏为顶部横向分区行（分组退化为分隔线）。 */
export function SettingsNav({ value, onSectionChange }: SettingsNavProps) {
  return (
    <nav
      aria-label="设置分区"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/40 p-2 md:w-[200px] md:flex-col md:gap-4 md:overflow-y-auto md:border-b-0 md:border-r"
    >
      {sectionGroups.map((group, index) => (
        <div className="flex shrink-0 gap-1 md:grid md:gap-1" key={group.title}>
          {index > 0 && (
            <span aria-hidden="true" className="mx-1 w-px shrink-0 bg-border md:hidden" />
          )}
          <span className="hidden h-6 items-center px-2 text-xs font-medium text-muted-foreground md:flex">
            {group.title}
          </span>
          {group.items.map(({ id, icon: Icon }) => {
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
        </div>
      ))}
    </nav>
  );
}
