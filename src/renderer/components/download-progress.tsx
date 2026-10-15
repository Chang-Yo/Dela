import { formatBytes } from '../features/classroom/player-format';
import { cn } from '../lib/utils';

/** 下载进度一行式（「软件更新」「Skills 组件」「能力拓展」共用）：左「已接收 / 总量」、
 *  中间进度条、右百分比。百分比向下取整，传输未完成时不提前显示 100%；总量未知显示
 *  「—」并停在 0%。尺寸列给最小宽，数字增长时行不左右抖动；进度条宽度由 barClassName
 *  给（设置行定宽、卡片里 flex-1）。 */
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
          className="h-full rounded-full bg-ink-2 transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span aria-hidden="true" className="w-10 shrink-0 text-right">
        {percent}%
      </span>
    </div>
  );
}
