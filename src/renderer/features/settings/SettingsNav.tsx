import {
  Archive,
  Blocks,
  Bot,
  Cloud,
  Info,
  Keyboard,
  LayoutGrid,
  Package,
  Palette,
  Plug,
  Puzzle,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsSectionId } from '../../../shared/settings';
import { cn } from '../../lib/utils';
import { useHorizontalWheel } from '../../lib/use-horizontal-wheel';
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
  { id: 'remotes', group: '数据', icon: Cloud },
  { id: 'providers', group: '模型', icon: Bot },
  { id: 'capabilities', group: '模型', icon: Blocks },
  { id: 'commands', group: '模型', icon: Terminal },
  { id: 'skills', group: '模型', icon: Puzzle },
  { id: 'mcp', group: '模型', icon: Server },
  { id: 'packages', group: '模型', icon: Package },
  { id: 'about', group: '关于', icon: Info },
  { id: 'privacy', group: '关于', icon: ShieldCheck },
  { id: 'terms', group: '关于', icon: ScrollText },
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
  // 窄屏那排横向分区行靠滚轮横滚；宽屏是纵列，不横向溢出，钩子自动放行。
  const navRef = useHorizontalWheel<HTMLElement>();

  return (
    <nav
      aria-label="设置分区"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-page p-2 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:w-[12.5rem] md:flex-col md:gap-4 md:overflow-y-auto md:border-b-0 md:border-r"
      ref={navRef}
    >
      {/* 壳层锚点：分区目录以「设置」标题开头（窄屏横向分区行不放标题）。 */}
      <span className="hidden px-2 pb-1 text-13 font-semibold text-ink md:block">设置</span>
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
                  'flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-13 transition-colors duration-150',
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
