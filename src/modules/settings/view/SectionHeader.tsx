import type { ReactNode } from 'react';

type SectionHeaderProps = {
  action?: ReactNode;
  description?: string;
  title: string;
};

export function SectionHeader({ action, description, title }: SectionHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="text-sm leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
