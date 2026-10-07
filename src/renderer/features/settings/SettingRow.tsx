import type { ReactNode } from 'react';

/**
 * 设置分区单行：标签列（标题+说明）贴左，控件列右对齐到内容右缘同一条竖线；
 * 行间用分隔线承担边界（外观/工作区共用）。控件与失败提示都落在右侧控件列。
 */
export function SettingRow({
  children,
  description,
  settingId,
  title,
}: {
  children: ReactNode;
  description?: string;
  settingId: string;
  title: string;
}) {
  return (
    <div className="border-b py-3 last:border-0" data-setting-id={settingId}>
      <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:gap-6">
        <div className="grid content-start gap-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="grid content-start justify-items-start gap-2 md:justify-items-end">
          {children}
        </div>
      </div>
    </div>
  );
}
