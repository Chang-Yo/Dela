import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../../lib/utils';

// API 沿用 shadcn（variant/size 名不变），外观对齐 beautiful-ui：冷灰 token、8px 圆角、
// 150ms 颜色过渡与按压微缩；聚焦环统一 bui-accent。
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-13 font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-ink text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:opacity-90',
        destructive:
          'bg-red text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:brightness-95',
        outline: 'bg-surface text-ink shadow-btn hover:bg-hover aria-expanded:bg-hover-2',
        secondary: 'bg-hover-2 text-ink hover:bg-line-strong',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink aria-expanded:bg-hover',
        link: 'text-bui-accent-ink underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-8 px-3 has-[>svg]:px-2.5',
        sm: 'h-7 px-2.5 text-xs has-[>svg]:px-2',
        lg: 'h-9 px-4 text-sm has-[>svg]:px-3',
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-xs': "size-6 rounded-chip [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      type={type ?? 'button'}
      {...props}
    />
  );
}

export { Button };
