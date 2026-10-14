/** Small progress ring with content in the center — the task-badge from the refs. */
export function ProgressRing({
  progress,
  tone = "orange",
  children,
  size = 28,
}: {
  progress: number; // 0..1
  tone?: "orange" | "green" | "red" | "accent" | "ink";
  children?: React.ReactNode;
  /** Dela 适配：默认根字号（16px）下的边长，按 rem 派生，随设置 › 外观 › 字号缩放。 */
  size?: number;
}) {
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tones = {
    orange: "var(--orange)",
    green: "var(--green)",
    red: "var(--red)",
    accent: "var(--bui-accent)",
    // Dela 适配：中性墨色档。
    ink: "var(--ink-2)",
  };
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
    >
      <svg className="-rotate-90 absolute inset-0 size-full" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tones[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          style={{ transition: "stroke-dashoffset 400ms cubic-bezier(0.23,1,0.32,1)" }}
        />
      </svg>
      <span className="relative text-xs font-semibold tabular-nums">
        {children}
      </span>
    </span>
  );
}
