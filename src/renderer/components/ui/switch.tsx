import { cn } from '../../lib/utils';

export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-input',
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}
