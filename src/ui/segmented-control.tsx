'use client';

import type { LucideIcon } from 'lucide-react';

export function SegmentedControl<T extends string>({
  options,
  labels,
  icons,
  value,
  onChange,
  className = '',
  'aria-label': label,
}: {
  options: readonly T[];
  labels?: Readonly<Record<T, string>>;
  icons?: Readonly<Partial<Record<T, LucideIcon>>>;
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const index = value === null ? -1 : options.indexOf(value);
  return (
    <div
      className={`relative inline-grid select-none rounded-card bg-inset p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      role="group"
      aria-label={label}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0.5 rounded-control bg-surface shadow-hairline
          transition-transform duration-slow ${index === -1 ? 'hidden' : ''}`}
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          left: '0.125rem',
          transform: `translateX(${index * 100}%)`,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      />
      {options.map((opt) => {
        const Icon: LucideIcon | undefined = icons?.[opt];
        return (
          <button
            key={opt}
            aria-pressed={opt === value}
            onClick={() => onChange(opt)}
            // 无 type 会默认提交表单（邮箱连接表单里也用到它）。
            type="button"
            className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-control px-2.5 py-1 text-xs
            transition-colors duration-base
            ${opt === value ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}
          >
            {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}
