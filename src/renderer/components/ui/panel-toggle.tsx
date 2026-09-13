import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '../../lib/utils';

type PanelToggleButtonProps = {
  collapsed: boolean;
  onToggle: () => void;
  /** 面板名称,用于生成"展开/收起 ××"提示。 */
  label: string;
  /** 折叠方向:面板在左侧用 left,在右侧用 right。 */
  side?: 'left' | 'right';
  /** 可选:受控面板元素的 id,映射到 aria-controls。 */
  controlsId?: string;
  className?: string;
};

export function PanelToggleButton({
  collapsed,
  onToggle,
  label,
  side = 'left',
  controlsId,
  className,
}: PanelToggleButtonProps) {
  const expandedIcon = side === 'right' ? PanelRightClose : PanelLeftClose;
  const collapsedIcon = side === 'right' ? PanelRightOpen : PanelLeftOpen;
  const Icon = collapsed ? collapsedIcon : expandedIcon;
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      onClick={onToggle}
      title={collapsed ? `展开${label}` : `收起${label}`}
      type="button"
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  );
}
