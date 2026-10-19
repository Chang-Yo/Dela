import type { ReactNode } from 'react';

/**
 * 设置分组容器：同类控件行共用 `bg-inset` 底色、分隔线内缩，读作同一列表；单个表单控件与信息展示型内容不再包一层。
 * 标题归容器主语：并列主题给目录项标题，总开关类标题放容器第一行；组级动作跟标签同行。
 */
export function SettingsGroup({
  action,
  children,
  description,
  settingId,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  /** 只对本组成立的导语：跟在标题下，不进容器。 */
  description?: ReactNode;
  settingId?: string;
  title?: ReactNode;
}) {
  return (
    <section className="grid gap-2" data-setting-id={settingId}>
      {(title || action) && (
        <SettingsGroupLabel action={action} description={description} title={title} />
      )}
      <div className="overflow-hidden rounded-card bg-inset px-4">{children}</div>
    </section>
  );
}

/** 分组标签行：不套容器的独立表单也复用它，保证同一页面里两种分组的标题是同一档。 */
export function SettingsGroupLabel({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="grid gap-1">
        {/* 与行标题同为 13px，靠字重与颜色（灰）分层。 */}
        <h2 className="text-13 font-semibold text-ink-2">{title ?? ''}</h2>
        {description && <p className="text-13 leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
