import type * as React from 'react';
import { cn } from './cn';

// 原生复选框，勾选色与 Switch 的开启色一致；文字由外层 label 包裹。
function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      className={cn('size-3.5 shrink-0 accent-ink', className)}
      data-slot="checkbox"
      type="checkbox"
      {...props}
    />
  );
}

export { Checkbox };
