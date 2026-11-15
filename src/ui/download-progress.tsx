import { formatBytes } from './format-bytes';
import { cn } from './cn';

/** 下载进度一行：百分比向下取整，未完成不显示 100%；尺寸列定最小宽，数字增长时不抖动。
 *  进度条宽度由调用方经 barClassName 给。 */
export function DownloadProgressRow({
  barClassName,
  label,
  received,
  total,
}: {
  barClassName?: string;
  label: string;
  received: number;
  total: number | null;
}) {
  const percent = total ? Math.floor((received / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs tabular-nums text-ink-3">
      <span className="min-w-28 shrink-0 whitespace-nowrap">
        {formatBytes(received) ?? '0 B'} / {total === null ? '—' : (formatBytes(total) ?? '—')}
      </span>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={cn('h-1 overflow-hidden rounded-full bg-line', barClassName)}
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-ink-2 transition-[width] duration-slower ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span aria-hidden="true" className="w-10 shrink-0 text-right">
        {percent}%
      </span>
    </div>
  );
}
