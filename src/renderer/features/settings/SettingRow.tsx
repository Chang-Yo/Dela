import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * 设置分区单行：标签列贴左，控件列右对齐；窄屏也保持这个方向，
 * 控件放不下时换行右对齐，而不是压成竖排（标签列最小 11rem）。
 */
export function SettingRow({
  children,
  description,
  leading,
  nested,
  settingId,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  /** 从属行（如总开关下的子项）：缩进一级，分隔线也跟着起点内移。 */
  nested?: boolean;
  settingId: string;
  title: ReactNode;
}) {
  const label = (
    <div className="grid content-start gap-1">
      <h3 className="text-13 font-medium text-ink">{title}</h3>
      {description && <p className="text-xs leading-relaxed text-ink-3">{description}</p>}
    </div>
  );
  return (
    <div
      className={cn('border-b border-line py-3.5 last:border-0', nested && 'ml-4')}
      data-setting-id={settingId}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {leading ? (
          <div className="flex w-44 min-w-0 grow items-center gap-3">
            {leading}
            {label}
          </div>
        ) : (
          <div className="w-44 grow">{label}</div>
        )}
        <div className="ml-auto grid content-start justify-items-end gap-2">{children}</div>
      </div>
    </div>
  );
}
