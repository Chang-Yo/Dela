import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

type PanelToggleProps = {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  controlsId?: string;
};

export function PanelToggle({ collapsed, onToggle, label, controlsId }: PanelToggleProps) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开${label}` : `收起${label}`}
      className="grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink"
      onClick={onToggle}
      title={collapsed ? `展开${label}` : `收起${label}`}
      type="button"
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  );
}
