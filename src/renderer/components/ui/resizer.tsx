import { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

type ResizerProps = {
  /** 无障碍名称,例如"调整邮件列表宽度"。 */
  label: string;
  /** 受控宽度,px;容器用 CSS 变量把它接到 grid 列宽上。 */
  value: number;
  min: number;
  max: number;
  /** 分隔条方向;默认垂直分隔左右面板。 */
  orientation?: 'vertical' | 'horizontal';
  onChange: (value: number) => void;
  /** 拖拽开始/结束回调;容器用它暂停列宽过渡,避免拖动滞后。 */
  onResizingChange?: (resizing: boolean) => void;
  /** 双击恢复到该值；省略时双击不改变尺寸。 */
  defaultValue?: number;
  className?: string;
};

export function Resizer({
  label,
  value,
  min,
  max,
  orientation = 'vertical',
  onChange,
  onResizingChange,
  defaultValue,
  className,
}: ResizerProps) {
  const start = useRef<{ pointerId: number; position: number; size: number } | null>(null);
  const horizontal = orientation === 'horizontal';

  // 拖拽中宿主卸载时 lostpointercapture 不会到达已移除元素，卸载时兜底复位 resizing 态。
  useEffect(() => () => onResizingChange?.(false), []);

  const clamp = (size: number) => Math.min(max, Math.max(min, size));
  const finishPointer = () => {
    if (!start.current) return;
    start.current = null;
    onResizingChange?.(false);
  };

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cn(
        'relative touch-none bg-transparent transition-colors focus-visible:outline-none',
        horizontal
          ? 'cursor-ns-resize before:absolute before:inset-x-0 before:-inset-y-2.5'
          : 'cursor-ew-resize before:absolute before:inset-y-0 before:-inset-x-2.5',
        'hover:bg-ink-3 focus-visible:bg-bui-accent',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'Home') {
          event.preventDefault();
          onChange(min);
          return;
        }
        if (event.key === 'End') {
          event.preventDefault();
          onChange(max);
          return;
        }
        const positive = horizontal ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
        const negative = horizontal ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
        if (!positive && !negative) return;
        event.preventDefault();
        // 向右/下拖动增宽；键盘步长 20px。
        onChange(clamp(value + (positive ? 20 : -20)));
      }}
      onDoubleClick={() => {
        if (defaultValue !== undefined) onChange(clamp(defaultValue));
      }}
      onLostPointerCapture={finishPointer}
      onPointerCancel={finishPointer}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        start.current = {
          pointerId: event.pointerId,
          position: horizontal ? event.clientY : event.clientX,
          size: value,
        };
        onResizingChange?.(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const begin = start.current;
        if (!begin || !event.isPrimary || event.pointerId !== begin.pointerId) return;
        const position = horizontal ? event.clientY : event.clientX;
        onChange(clamp(begin.size + (position - begin.position)));
      }}
      onPointerUp={(event) => {
        if (!event.isPrimary || event.pointerId !== start.current?.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        finishPointer();
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
