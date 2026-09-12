import {
  FilePenLine,
  FileText,
  Folder,
  LayoutDashboard,
  ListChecks,
  Plus,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { cn } from '../../lib/utils';

const projectItems = ['概览', '实验要求', 'slides.pdf', 'notes.md', '检查清单'];

const ITEM_ICONS: Record<string, LucideIcon> = {
  概览: LayoutDashboard,
  实验要求: FileText,
  'slides.pdf': Presentation,
  'notes.md': FilePenLine,
  检查清单: ListChecks,
};

type ProjectSidebarProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function ProjectSidebar({
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapsed,
}: ProjectSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-r bg-muted/40 max-md:flex-row max-md:items-center max-md:gap-1 max-md:border-r-0 max-md:border-b max-md:overflow-x-auto max-md:p-2">
      <div className="flex h-11 shrink-0 items-center gap-1.5 p-2 max-md:hidden">
        <PanelToggleButton
          collapsed={collapsed}
          controlsId="project-items"
          label="项目内容"
          onToggle={onToggleCollapsed}
        />
        {!collapsed && (
          <span className="truncate text-xs font-medium text-muted-foreground">项目内容</span>
        )}
      </div>
      <nav
        aria-label="项目内容"
        className={cn(
          'grid content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2 max-md:flex max-md:flex-row max-md:items-center max-md:overflow-x-auto max-md:p-0 max-md:[scrollbar-width:none]',
          collapsed && 'px-1.5',
        )}
        id="project-items"
      >
        {projectItems.map((item) => {
          const Icon = ITEM_ICONS[item] ?? Folder;
          const selected = item === activeTab;
          return (
            <button
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                collapsed && 'w-8 justify-center px-0 max-md:w-auto max-md:px-3',
                selected
                  ? 'bg-background font-medium text-foreground shadow-xs'
                  : 'text-foreground/70 hover:bg-background/60 hover:text-foreground',
              )}
              key={item}
              onClick={() => onTabChange(item)}
              title={collapsed ? item : undefined}
              type="button"
            >
              <Icon
                className={cn('size-4 shrink-0', selected ? '' : 'text-muted-foreground')}
                strokeWidth={1.8}
              />
              <span className={cn('truncate', collapsed && 'hidden max-md:inline')}>{item}</span>
            </button>
          );
        })}
      </nav>
      <button
        className={cn(
          'mb-2 mt-5 h-[34px] shrink-0 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors hover:bg-background/60 max-md:hidden',
          collapsed
            ? 'mx-auto grid w-8 place-items-center'
            : 'mx-2 flex items-center justify-center gap-1',
        )}
        title={collapsed ? '添加资料' : undefined}
        type="button"
      >
        <Plus className="size-3.5" strokeWidth={1.8} />
        {!collapsed && <span>添加资料</span>}
      </button>
    </aside>
  );
}
