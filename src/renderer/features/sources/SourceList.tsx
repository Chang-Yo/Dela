import { ClipboardList, Folder, Megaphone, RefreshCw, type LucideIcon } from 'lucide-react';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { cn } from '../../lib/utils';

const courseItems: Array<{ name: string; meta: string; icon: LucideIcon }> = [
  { name: '机器学习 · Lab 1', meta: '9 月 12 日截止', icon: ClipboardList },
  { name: '计算机网络 · Assignment 2', meta: '9 月 18 日截止', icon: ClipboardList },
  { name: '人工智能 · 课程通知', meta: '昨天更新', icon: Megaphone },
];

type SourceListProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function SourceList({ collapsed, onToggleCollapsed }: SourceListProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-r bg-muted/40 max-md:border-r-0 max-md:border-b">
      <div className="flex h-11 shrink-0 items-center gap-1.5 p-2">
        <PanelToggleButton
          collapsed={collapsed}
          controlsId="sources-list"
          label="资料列表"
          onToggle={onToggleCollapsed}
        />
        {!collapsed && (
          <>
            <span className="truncate text-xs font-medium text-muted-foreground">课程内容</span>
            <div className="flex-1" />
            <button
              aria-label="刷新资料"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title="刷新资料"
              type="button"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
      <nav
        aria-label="课程内容"
        className={cn(
          'grid content-start gap-0.5 overflow-y-auto overflow-x-hidden p-2',
          collapsed && 'px-1.5',
        )}
        id="sources-list"
      >
        {courseItems.map((item, index) => {
          const Icon = item.icon ?? Folder;
          const selected = index === 0;
          return (
            <button
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'grid w-full gap-2 rounded-lg p-3 text-left transition-colors',
                collapsed && 'w-8 justify-items-center px-0 py-2 max-md:w-full max-md:px-3',
                selected ? 'bg-background shadow-xs' : 'hover:bg-background/60',
              )}
              key={item.name}
              title={collapsed ? item.name : undefined}
              type="button"
            >
              <Icon
                className="size-4 shrink-0 self-center text-muted-foreground"
                strokeWidth={1.8}
              />
              <span className={cn('grid gap-2', collapsed && 'hidden max-md:grid')}>
                <strong className="text-sm">{item.name}</strong>
                <span className="text-xs text-muted-foreground">{item.meta}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}
