import { CalendarDays } from 'lucide-react';
import type { Navigate } from '../../../app/module';
import { Button } from '../../../ui/button';
import { CredentialRow } from '../../../modules/settings/view';
import { useTimetableState } from './use-timetable';

export function TimetableCredential({ navigate }: { navigate: Navigate }) {
  const syncedAt = useTimetableState().data?.lastSyncedAt;
  return (
    <CredentialRow
      connected={Boolean(syncedAt)}
      icon={CalendarDays}
      name="教学信息服务网"
      settingId="timetable"
      status={syncedAt ? '已同步' : '未同步'}
    >
      <Button
        className="shrink-0"
        onClick={() => navigate({ page: 'timetable' })}
        size="sm"
        variant="secondary"
      >
        前往
      </Button>
    </CredentialRow>
  );
}
