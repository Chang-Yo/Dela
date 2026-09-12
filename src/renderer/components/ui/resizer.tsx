import { useRef, type PointerEvent } from 'react';
import { cn } from '../../lib/utils';

type ResizerProps = {
  /** 无障碍名称,例如"调整邮件列表宽度"。 */
  label: string;
  /** 受控宽度,px;容器用 CSS 变量把它接到 grid 列宽上。 */
  value: number;
  min: number;
  max: number;
  /** direction=1 向右拖动增宽;direction=-1 向左拖动增宽(面板在右侧时)。 */
  direction?: 1 | -1;
  /** 键盘每次调整的步长,px。 */
  step?: number;
  onChange: (value: number) => void;
  /** 拖拽开始/结束回调;容器用它暂停列宽过渡,避免拖动滞后。 */
  onResizingChange?: (resizing: boolean) => void;
  className?: string;
};

export function Resizer({
  label,
  value,
  min,
  max,
  direction = 1,
  step = 20,
  onChange,
  onResizingChange,
  className,
}: ResizerProps) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const clamp = (width: number) => Math.min(max, Math.max(min, width));

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cn(
        'relative cursor-ew-resize touch-none bg-border transition-colors focus-visible:outline-none',
        // 命中区向两侧面板各延伸 10px,视觉线本身仅 1px。
        'before:absolute before:inset-y-0 before:-inset-x-2.5',
        'hover:bg-foreground/40 focus-visible:bg-foreground/40',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onChange(clamp(value + direction * (event.key === 'ArrowRight' ? step : -step)));
      }}
      onPointerCancel={() => {
        start.current = null;
        onResizingChange?.(false);
      }}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width: value };
        onResizingChange?.(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const begin = start.current;
        if (!begin) return;
        onChange(clamp(begin.width + direction * (event.clientX - begin.x)));
      }}
      onPointerUp={(event) => {
        start.current = null;
        onResizingChange?.(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
