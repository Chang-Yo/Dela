import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/cn';

const statusPillVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium leading-none',
  {
    variants: {
      size: {
        default: 'h-6 px-2.5 text-sm',
        sm: 'h-5 px-2 text-xs',
      },
      tone: {
        green: 'bg-success-tint text-success',
        orange: 'bg-warning-tint text-warning',
        red: 'bg-danger-tint text-danger',
        accent: 'bg-accent-tint text-accent-ink',
        neutral: 'bg-inset text-ink-2',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'default' },
  },
);

type Tone = NonNullable<VariantProps<typeof statusPillVariants>['tone']>;

const dotColor: Record<Tone, string> = {
  green: 'bg-success',
  orange: 'bg-warning',
  red: 'bg-danger',
  accent: 'bg-accent',
  neutral: 'bg-ink-3',
};

export function StatusPill({
  tone = 'neutral',
  size,
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  size?: VariantProps<typeof statusPillVariants>['size'];
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(statusPillVariants({ tone, size }), className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dotColor[tone])} />}
      {children}
    </span>
  );
}
