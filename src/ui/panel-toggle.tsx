import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

type PanelToggleButtonProps = {
  collapsed: boolean;
  onToggle: () => void;
  /** 面板名称,用于生成"展开/收起 ××"提示。 */
  label: string;
  /** 可选:受控面板元素的 id,映射到 aria-controls。 */
  controlsId?: string;
};

export function PanelToggleButton({
  collapsed,
  onToggle,
  label,
  controlsId,
}: PanelToggleButtonProps) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className="grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink"
      onClick={onToggle}
      title={collapsed ? `展开${label}` : `收起${label}`}
      type="button"
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  );
}
