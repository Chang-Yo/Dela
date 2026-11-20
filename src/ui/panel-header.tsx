import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './lib/cn';

const panelHeaderVariants = cva('flex shrink-0 items-center', {
  variants: {
    variant: {
      bordered: 'gap-2 border-b border-line px-3',
      plain: 'gap-1 px-2',
    },
    size: { default: 'h-10', lg: 'h-11' },
  },
  defaultVariants: { variant: 'bordered', size: 'default' },
});

function PanelHeader({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'header'> & VariantProps<typeof panelHeaderVariants>) {
  return (
    <header
      className={cn(panelHeaderVariants({ variant, size }), className)}
      data-slot="panel-header"
      {...props}
    />
  );
}

export { PanelHeader };
