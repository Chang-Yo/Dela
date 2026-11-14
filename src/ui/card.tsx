import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

// outline 是列表容器（行自带内边距，常配 divide-y）；surface 是带内边距的内容卡片；
// inset 是无边框的浅底分组，用于说明、引用与聊天里的附加信息。
const cardVariants = cva('rounded-card', {
  variants: {
    variant: {
      outline: 'overflow-hidden border border-line',
      surface: 'border border-line bg-surface p-4',
      inset: 'bg-inset px-4 py-3',
    },
  },
  defaultVariants: { variant: 'outline' },
});

function Card({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp className={cn(cardVariants({ variant }), className)} data-slot="card" {...props} />;
}

export { Card };
