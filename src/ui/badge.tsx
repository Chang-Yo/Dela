import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './lib/cn';

const statusVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium leading-none',
  {
    variants: {
      size: {
        xs: 'h-6 px-2.5 text-sm',
        '2xs': 'h-5 px-2 text-xs',
      },
      tone: {
        success: 'bg-success-tint text-success',
        warning: 'bg-warning-tint text-warning',
        danger: 'bg-danger-tint text-danger',
        accent: 'bg-accent-tint text-accent-ink',
        neutral: 'bg-inset text-ink-2',
      },
    },
  },
);

type Tone = NonNullable<VariantProps<typeof statusVariants>['tone']>;

const dotColor: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
  neutral: 'bg-ink-3',
};

type BadgeProps = Omit<React.ComponentProps<'span'>, 'children'> &
  (
    | (VariantProps<typeof statusVariants> & {
        variant?: 'status';
        dot?: boolean;
        children: React.ReactNode;
      })
    | { variant: 'count'; count: number }
  );

function Badge(props: BadgeProps) {
  if (props.variant === 'count') {
    const { variant: _variant, count, className, ...rest } = props;
    return (
      <span
        className={cn(
          'min-w-4 rounded-full bg-ink px-1 text-center text-xs font-medium leading-4 tabular-nums text-surface',
          className,
        )}
        data-slot="badge"
        {...rest}
      >
        {count > 99 ? '99+' : count}
      </span>
    );
  }
  const {
    variant: _variant,
    tone = 'neutral',
    size = 'xs',
    dot = true,
    children,
    className,
    ...rest
  } = props;
  return (
    <span className={cn(statusVariants({ tone, size }), className)} data-slot="badge" {...rest}>
      {dot && <span className={cn('size-1.5 rounded-full', dotColor[tone ?? 'neutral'])} />}
      {children}
    </span>
  );
}

export { Badge };
