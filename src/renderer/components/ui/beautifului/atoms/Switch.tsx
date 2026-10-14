import { cn } from '@/lib/utils';

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
      // Dela 适配：上游 Switch 基础上增加三态（indeterminate）、disabled 与聚焦环，尺寸收为 h-5 w-9。
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-ink' : indeterminate ? 'bg-ink/40' : 'bg-line-strong',
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-(--ease-out-strong)',
          checked ? 'translate-x-4' : indeterminate && 'translate-x-2',
        )}
      />
    </button>
  );
}
