import type { ReactNode } from 'react';

/**
 * 设置分组容器：一组同类控件行共用一块底色（`bg-inset` 在明暗两套主题里都比页面底暗一档），
 * 行自带的 `border-b` 被容器左右内边距收进来，读作「同一个列表」。
 *
 * 底色块解决的是「并列关系」：一组行之间、或主从布局里的一栏。单个表单控件（如全局指令的
 * 输入框）不需要再包一层——它自己就是一块面，套上容器只是多一圈灰。
 *
 * 标题位置由「容器的主语是谁」决定：容器上方的是**目录项**（一个页面里并列多个主题时才给）；
 * 组里有主语控件（总开关）的不传标题，把标题做成容器内第一行（见通用页的「试验功能」）。
 * 只有一组、或标题与页面标题重复时两者都不给。信息展示型内容不进容器。
 *
 * 组级动作（作用于容器里全部内容的按钮）跟标签同行，位置与作用域一致；作用于整页的动作留在
 * 页面标题行（SectionHeader）。
 */
export function SettingsGroup({
  action,
  children,
  description,
  settingId,
  title,
}: {
  /** 组级动作：渲染在标签行右缘。 */
  action?: ReactNode;
  children: ReactNode;
  /** 只对本组成立的导语：跟在标题下，不进容器。 */
  description?: ReactNode;
  settingId?: string;
  /** 组标题：带图标或计数时传节点，样式仍是分组标签那一档。 */
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
        <h2 className="text-[13px] font-semibold text-ink-2">{title ?? ''}</h2>
        {description && <p className="text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
