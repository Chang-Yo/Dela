import type { ReactNode } from 'react';
import { Card } from '../../../ui/card';

export function SettingsGroup({
  action,
  children,
  description,
  settingId,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  settingId?: string;
  title?: ReactNode;
}) {
  return (
    <section className="grid gap-2" data-setting-id={settingId}>
      {(title || action) && (
        <SettingsGroupLabel action={action} description={description} title={title} />
      )}
      <Card className="overflow-hidden py-0" variant="inset">
        {children}
      </Card>
    </section>
  );
}

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
        <h2 className="text-sm font-semibold text-ink-2">{title ?? ''}</h2>
        {description && <p className="text-sm leading-relaxed text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
