import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';

function PanelToggle({
  collapsed,
  onToggle,
  label,
  controlsId,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick'> & {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  controlsId?: string;
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink',
        className,
      )}
      data-slot="panel-toggle"
      onClick={onToggle}
      title={collapsed ? `展开${label}` : `收起${label}`}
      type="button"
      {...props}
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  );
}

export { PanelToggle };
