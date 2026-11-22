import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './lib/cn';

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
  'aria-label': string;
  indeterminate?: boolean;
};

function Switch({ className, checked, indeterminate, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      aria-checked={indeterminate ? 'mixed' : checked}
      checked={checked}
      className={cn(
        'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-slow outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-accent',
        indeterminate ? 'bg-accent/40' : 'bg-line-strong',
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 rounded-full bg-on-accent shadow-thumb transition-transform duration-slow ease-(--ease-out-strong) data-[state=checked]:translate-x-4',
          indeterminate && 'translate-x-2',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
