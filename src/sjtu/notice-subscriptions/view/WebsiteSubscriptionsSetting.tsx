import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '../../../core/protocol/contract';
import { SettingRow, SettingsGroup } from '../../../modules/settings/view';
import { Switch } from '../../../ui/switch';
import { showToast } from '../../../ui/toast';
import { WEBSITE_SUBSCRIPTIONS_SETTING } from '../contract';
import { useWebsiteSubscriptions, websiteSubscriptionsClient } from './use-website-subscriptions';

export function WebsiteSubscriptionsSetting() {
  const subscriptions = useWebsiteSubscriptions();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      websiteSubscriptionsClient.setNoticeSubscriptionsEnabled(enabled),
    onSuccess: () => subscriptions.refetch(),
    onError: (cause) =>
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) }),
  });
  return (
    <SettingsGroup title="试验功能">
      <SettingRow settingId={WEBSITE_SUBSCRIPTIONS_SETTING} title="通用公告订阅">
        <Switch
          aria-label="通用公告订阅"
          checked={subscriptions.data?.experimental ?? false}
          disabled={!subscriptions.data || toggle.isPending}
          onCheckedChange={(enabled) => toggle.mutate(enabled)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
