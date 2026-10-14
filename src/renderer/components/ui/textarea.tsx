import type * as React from 'react';
import { cn } from '../../lib/utils';

// 样式 token 与 input.tsx 对齐（field 底、hairline 描边、accent 聚焦），
// 仅替换为 textarea 并去掉 file 输入专用类；高度用 min-h 而非固定 h，供调用方按需覆盖。
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-16 py-1.5 leading-relaxed',
        'placeholder:text-ink-3 selection:bg-bui-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-13 text-ink transition-[background-color,box-shadow] duration-150 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'bg-field shadow-hairline hover:shadow-[0_0_0_1px_var(--line-strong)] focus-visible:bg-surface focus-visible:shadow-[0_0_0_1px_var(--bui-accent),0_0_0_3px_var(--bui-accent-tint)]',
        'aria-invalid:shadow-[0_0_0_1px_var(--red)]',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
