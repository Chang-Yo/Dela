import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { Alert } from '../../../ui/alert';
import { Switch } from '../../../ui/switch';
import { notificationsClient, useNotificationSubscriptions } from './use-notifications';

export function SubscriptionsPanel({ children }: { children: ReactNode }) {
  const subscriptions = useNotificationSubscriptions();
  const toggle = useMutation({
    mutationFn: notificationsClient.setBuiltInSubscription,
    onSuccess: () => subscriptions.refetch(),
  });
  const error = toggle.error ?? subscriptions.error;

  return (
    <section
      aria-label="订阅管理"
      className="mt-4 flex flex-col gap-3 rounded-card bg-inset px-4 py-3"
    >
      {subscriptions.data?.map((item) => (
        <div className="flex items-center justify-between gap-3" key={item.id}>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{item.label}</div>
            <div className="truncate text-xs text-ink-3">{item.url}</div>
          </div>
          <Switch
            aria-label={`订阅${item.label}通知`}
            checked={item.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(enabled) => toggle.mutate({ id: item.id, enabled })}
          />
        </div>
      ))}
      {error ? <Alert role="alert">{errorMessage(error)}</Alert> : null}
      {children}
    </section>
  );
}
