import { cn } from './lib/cn';

export function Switch({
  checked,
  disabled,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-slow outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-ink' : indeterminate ? 'bg-ink/40' : 'bg-line-strong',
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-on-accent shadow-thumb transition-transform duration-slow ease-(--ease-out-strong)',
          checked ? 'translate-x-4' : indeterminate && 'translate-x-2',
        )}
      />
    </button>
  );
}
