import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type * as React from 'react';
import { Button } from './button';

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
    <Button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className={className}
      data-slot="panel-toggle"
      onClick={onToggle}
      size="icon-sm"
      title={collapsed ? `展开${label}` : `收起${label}`}
      variant="ghost"
      {...props}
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </Button>
  );
}

export { PanelToggle };
