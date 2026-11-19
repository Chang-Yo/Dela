import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { SettingRow } from '../../settings/view';
import { showToast } from '../../../ui/toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import type { MailTrashRetention } from '../contract';
import { mailClient, useMailState } from './use-mail';

const retentionKey = ['mail', 'trashRetention'];

export function MailStorage() {
  const connected = Boolean(useMailState()?.account);
  const queryClient = useQueryClient();
  const retention = useQuery({
    queryKey: retentionKey,
    queryFn: () => mailClient.trashRetention(),
    enabled: connected,
  }).data;
  const change = useMutation({
    mutationFn: (value: MailTrashRetention) => mailClient.setTrashRetention(value),
    onSuccess: (next) => queryClient.setQueryData(retentionKey, next),
    onError: (error) =>
      showToast({ variant: 'error', title: '保存保留期失败', description: errorMessage(error) }),
  });
  if (!connected || retention === undefined) return null;
  return (
    <SettingRow settingId="mail-trash-retention" title="已删除邮件保留">
      <Select
        onValueChange={(value) => change.mutate(Number(value) as MailTrashRetention)}
        value={String(change.isPending ? change.variables : retention)}
      >
        <SelectTrigger aria-label="已删除邮件保留" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7">7 天</SelectItem>
          <SelectItem value="30">30 天</SelectItem>
          <SelectItem value="90">90 天</SelectItem>
          <SelectItem value="0">永久</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
