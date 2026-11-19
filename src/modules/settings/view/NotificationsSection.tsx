import { SectionHeader } from './SectionHeader';
import { SystemNotifications } from './SystemNotifications';

export function NotificationsSection() {
  return (
    <div className="grid gap-10">
      <SectionHeader title="通知" />
      <SystemNotifications />
    </div>
  );
}
