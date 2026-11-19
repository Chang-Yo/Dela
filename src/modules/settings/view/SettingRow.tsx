import type { ReactNode } from 'react';
import { cn } from '../../../ui/cn';

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
  nested?: boolean;
  settingId: string;
  title: ReactNode;
}) {
  const label = (
    <div className="grid content-start gap-1">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
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
