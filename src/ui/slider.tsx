import { Slider as SliderPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './lib/cn';

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-4 w-full touch-none select-none items-center', className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-line-strong">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-checked" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-3 rounded-full bg-on-accent shadow-thumb',
          'outline-none transition-transform active:scale-[0.94]',
          'focus-visible:ring-2 focus-visible:ring-accent',
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
