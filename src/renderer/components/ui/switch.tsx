import { cn } from '../../lib/utils';

export function Switch({
  checked,
  disabled,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  /** 三态：整域开关在“部分开启”时用中间态展示，点击即全部开启。 */
  indeterminate?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked ? 'bg-primary' : indeterminate ? 'bg-primary/40' : 'bg-input',
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-4' : indeterminate && 'translate-x-2',
        )}
      />
    </button>
  );
}
