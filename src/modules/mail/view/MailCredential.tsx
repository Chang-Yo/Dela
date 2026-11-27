import { Mail } from 'lucide-react';
import type { Navigate } from '../../../app/module';
import { CredentialRow } from '../../settings/view';
import { Button } from '../../../ui/button';
import { useMailState } from './use-mail';

export function MailCredential({ navigate }: { navigate: Navigate }) {
  const address = useMailState()?.account?.address;
  return (
    <CredentialRow
      connected={Boolean(address)}
      icon={Mail}
      name="邮箱"
      settingId="mail"
      status={address ? `已连接 · ${address}` : '未配置'}
    >
      <Button
        className="shrink-0"
        onClick={() => navigate({ page: 'mail' })}
        size="sm"
        variant="secondary"
      >
        前往
      </Button>
    </CredentialRow>
  );
}
