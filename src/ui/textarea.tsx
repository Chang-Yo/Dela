import type * as React from 'react';
import { cn } from './cn';

// 样式 token 与 input.tsx 对齐（field 底、hairline 描边、accent 聚焦），
// 仅替换为 textarea 并去掉 file 输入专用类；高度用 min-h 而非固定 h，供调用方按需覆盖。
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-16 py-1.5',
        'placeholder:text-ink-3 selection:bg-bui-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-sm leading-relaxed text-ink transition-[background-color,box-shadow] duration-base outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'bg-field shadow-hairline hover:shadow-hairline-strong focus-visible:bg-surface focus-visible:shadow-focus',
        'aria-invalid:shadow-invalid',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
