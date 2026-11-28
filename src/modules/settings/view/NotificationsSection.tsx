import type { ViewDefinition } from '../../../app/module';
import { SectionHeader } from './SectionHeader';
import { SystemNotifications } from './SystemNotifications';

export function NotificationsSection({ views }: { views: ViewDefinition[] }) {
  return (
    <div className="grid gap-10">
      <SectionHeader title="通知" />
      <div className="grid gap-2">
        {views.map(({ settings }, index) => {
          const Notifications = settings?.notifications;
          return Notifications && <Notifications key={index} />;
        })}
        <SystemNotifications />
      </div>
    </div>
  );
}
