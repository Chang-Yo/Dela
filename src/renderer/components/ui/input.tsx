import type * as React from 'react';
import { cn } from '../../lib/utils';

// default 保持标准输入框外观；ghost 无边框透明、无阴影，聚焦只保留 ring 不加边框，
// 供面板内的裸输入（如标题行）使用。
// 外观对齐 beautiful-ui 的字段：field 底 + hairline 描边，聚焦换成 surface 底 + accent 描边。
const inputVariants = {
  default:
    'bg-field shadow-hairline hover:shadow-[0_0_0_1px_var(--line-strong)] focus-visible:bg-surface focus-visible:shadow-[0_0_0_1px_var(--bui-accent),0_0_0_3px_var(--bui-accent-tint)]',
  ghost: '',
} as const;

function Input({
  className,
  type,
  variant = 'default',
  ...props
}: React.ComponentProps<'input'> & { variant?: keyof typeof inputVariants }) {
  return (
    <input
      className={cn(
        'h-8 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-13 file:font-medium file:text-ink',
        'placeholder:text-ink-3 selection:bg-bui-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-13 text-ink transition-[background-color,box-shadow] duration-150 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:shadow-[0_0_0_1px_var(--red)]',
        inputVariants[variant],
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
