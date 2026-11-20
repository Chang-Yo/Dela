'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from './lib/cn';

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.05,
  ariaLabel,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <SliderPrimitive.Root
      aria-label={ariaLabel}
      className={cn('relative flex h-4 w-full touch-none select-none items-center', className)}
      max={max}
      min={min}
      onValueChange={(values) => onValueChange(values[0] ?? min)}
      step={step}
      value={[value]}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-line-strong">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-ink" />
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
