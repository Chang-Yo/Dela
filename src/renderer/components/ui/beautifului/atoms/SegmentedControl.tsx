"use client";

/** Segmented control — equal-width segments, sliding thumb；外观对齐设置 › Skills 的来源页签。 */
export function SegmentedControl<T extends string>({
  options,
  labels,
  value,
  onChange,
  className = "",
}: {
  options: readonly T[];
  /** 选项的显示文案；缺省直接用选项值本身。 */
  labels?: Readonly<Record<T, string>>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const index = options.indexOf(value);
  return (
    <div
      className={`relative inline-grid select-none rounded-card bg-inset p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      role="group"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 rounded-control bg-surface shadow-hairline
          transition-transform duration-200"
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          left: '0.125rem',
          transform: `translateX(${index * 100}%)`,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
      {options.map((opt) => (
        <button
          key={opt}
          aria-pressed={opt === value}
          onClick={() => onChange(opt)}
          // Dela 适配：分段控件现在也用在表单里（邮箱连接），无 type 会默认提交表单。
          type="button"
          className={`relative z-10 rounded-control px-2.5 py-1 text-xs
            transition-colors duration-150
            ${opt === value ? "text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}
