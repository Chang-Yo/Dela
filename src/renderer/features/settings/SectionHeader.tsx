import type { ReactNode } from 'react';

type SectionHeaderProps = {
  /** 页面级动作（如「全部恢复默认」「添加提供商」），固定在标题行右缘。 */
  action?: ReactNode;
  /** 页面导语：使用前提与操作方式，弱化为 muted 一行。 */
  description?: string;
  title: string;
};

/** 设置页首层锚点：页面标题是整页最大的文字，右缘承接页面级动作。 */
export function SectionHeader({ action, description, title }: SectionHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="text-13 leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
