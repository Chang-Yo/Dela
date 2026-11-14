import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const statusPillVariants = cva(
  'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium leading-none',
  {
    variants: {
      tone: {
        green: 'bg-success-tint text-success',
        orange: 'bg-warning-tint text-warning',
        red: 'bg-danger-tint text-danger',
        accent: 'bg-accent-tint text-accent-ink',
        neutral: 'bg-inset text-ink-2',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type Tone = NonNullable<VariantProps<typeof statusPillVariants>['tone']>;

/* the leading dot lives on a separate element, so its color stays a small lookup */
const dotColor: Record<Tone, string> = {
  green: 'bg-success',
  orange: 'bg-warning',
  red: 'bg-danger',
  accent: 'bg-accent',
  neutral: 'bg-ink-3',
};

export function StatusPill({
  tone = 'neutral',
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(statusPillVariants({ tone }), className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dotColor[tone])} />}
      {children}
    </span>
  );
}
