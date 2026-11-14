import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../../ui/cn';

/** 设置 › 凭据 的一行：服务名、连接状态与右侧操作；各模块登记自己的一行。 */
export function CredentialRow({
  children,
  connected,
  description,
  icon: Icon,
  name,
  settingId,
  status,
}: {
  /** 右侧的操作按钮与内联设置。 */
  children: ReactNode;
  connected: boolean;
  /** 防误解的关键说明（如授权范围）；其余凭据不显示描述。 */
  description?: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  name: string;
  /** 搜索直达与高亮目标。 */
  settingId: string;
  status: string;
}) {
  return (
    <li
      className="flex items-center justify-between gap-4 border-b py-3 last:border-0 max-md:items-start"
      data-setting-id={settingId}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-card bg-fill">
          <Icon className="size-4 text-ink-3" strokeWidth={1.8} />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <strong className="text-sm">{name}</strong>
          {description && (
            <span className="truncate text-xs text-ink-3" title={description}>
              {description}
            </span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* 状态用颜色说话：绿点=已连接，灰点=未连接；文字只补充细节。 */}
        <span
          className={cn(
            'flex min-w-[4.5rem] max-w-40 items-center gap-1.5 text-xs max-md:min-w-0',
            connected ? 'text-ink' : 'text-ink-3',
          )}
          title={status}
        >
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-ink-3')}
          />
          <span className="truncate">{status}</span>
        </span>
        {children}
      </div>
    </li>
  );
}
