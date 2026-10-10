"use client";

// Dela 适配：上游无 Slider；按 Switch 的中性语言封装 radix Slider
// （bg-line-strong 槽 / bg-ink 填充 / 白色拇指），供音量等连续值调节使用。
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

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
          'block size-3 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
          'outline-none transition-transform active:scale-[0.94]',
          'focus-visible:ring-2 focus-visible:ring-bui-accent',
        )}
      />
    </SliderPrimitive.Root>
  );
}
