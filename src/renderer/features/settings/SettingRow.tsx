import type { ReactNode } from 'react';

/** 设置分区单行：标签列（标题+说明）+ 控件列，行间用分隔线承担边界（外观/工作区共用）。 */
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
    <div className="grid gap-3 border-b pb-5 last:border-0 last:pb-0" data-setting-id={settingId}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(140px,210px)_minmax(0,1fr)] md:gap-6">
        <div className="grid content-start gap-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
