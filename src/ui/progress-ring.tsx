export function ProgressRing({
  progress,
  tone = 'warning',
  children,
  size = 28,
}: {
  progress: number; // 0..1
  tone?: 'warning' | 'success' | 'danger' | 'accent' | 'neutral';
  children?: React.ReactNode;
  size?: number;
}) {
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tones = {
    warning: 'var(--warning)',
    success: 'var(--success)',
    danger: 'var(--danger)',
    accent: 'var(--accent)',
    neutral: 'var(--ink-2)',
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
          style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.23,1,0.32,1)' }}
        />
      </svg>
      <span className="relative text-xs font-semibold tabular-nums">{children}</span>
    </span>
  );
}
