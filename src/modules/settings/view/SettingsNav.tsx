import {
  Archive,
  Bell,
  Blocks,
  Bot,
  Cloud,
  HardDrive,
  Info,
  KeyRound,
  Keyboard,
  LayoutGrid,
  Palette,
  Puzzle,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { settingsSectionLabels, type SettingsSectionId } from '../contract';
import { cn } from '../../../ui/lib/cn';
import { useHorizontalWheel } from '../../../ui/hooks/use-horizontal-wheel';

export type { SettingsSectionId };

const sections: Array<{ id: SettingsSectionId; group: string; icon: LucideIcon }> = [
  { id: 'general', group: '通用', icon: SlidersHorizontal },
  { id: 'appearance', group: '通用', icon: Palette },
  { id: 'shortcuts', group: '通用', icon: Keyboard },
  { id: 'notifications', group: '通用', icon: Bell },
  { id: 'storage', group: '通用', icon: HardDrive },
  { id: 'connections', group: '通用', icon: KeyRound },
  { id: 'providers', group: 'Agent', icon: Bot },
  { id: 'capabilities', group: 'Agent', icon: Blocks },
  { id: 'commands', group: 'Agent', icon: Terminal },
  { id: 'skills', group: 'Agent', icon: Puzzle },
  { id: 'mcp', group: 'Agent', icon: Server },
  { id: 'workspace', group: '工作区', icon: LayoutGrid },
  { id: 'remotes', group: '工作区', icon: Cloud },
  { id: 'archived', group: '工作区', icon: Archive },
  { id: 'about', group: '其他', icon: Info },
  { id: 'privacy', group: '其他', icon: ShieldCheck },
  { id: 'terms', group: '其他', icon: ScrollText },
];

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

export function SettingsNav({ value, onSectionChange }: SettingsNavProps) {
  // 窄屏那排横向分区行靠滚轮横滚；宽屏是纵列，不横向溢出，钩子自动放行。
  const navRef = useHorizontalWheel<HTMLElement>();

  return (
    <nav
      aria-label="设置分区"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-page p-2 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:w-50 md:flex-col md:gap-4 md:overflow-y-auto md:border-b-0 md:border-r"
      ref={navRef}
    >
      <span className="hidden px-2 pb-1 text-sm font-semibold text-ink md:block">设置</span>
      {sectionGroups.map((group, index) => (
        <div className="flex shrink-0 gap-1 md:grid md:gap-1" key={group.title}>
          {index > 0 && (
            <span aria-hidden="true" className="mx-1 w-px shrink-0 bg-line md:hidden" />
          )}
          <span className="hidden h-6 items-center px-2 text-xs font-medium text-ink-3 md:flex">
            {group.title}
          </span>
          {group.items.map(({ id, icon: Icon }) => {
            const active = value === id;
            return (
              <button
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors duration-base',
                  active
                    ? 'bg-surface font-medium text-ink shadow-hairline'
                    : 'text-ink-2 hover:bg-hover hover:text-ink',
                )}
                key={id}
                onClick={() => onSectionChange(id)}
                type="button"
              >
                <Icon
                  className={cn('size-4 shrink-0', active ? 'text-ink' : 'text-ink-3')}
                  strokeWidth={1.8}
                />
                <span className="truncate">{settingsSectionLabels[id]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
