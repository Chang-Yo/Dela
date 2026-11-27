import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff } from 'lucide-react';
import type { TaskNotificationPrefs } from '../contract';
import {
  notificationsClient,
  useNotificationState,
  useNotificationSubscriptions,
} from '../../notifications/view';
import { Button } from '../../../ui/button';
import { Switch } from '../../../ui/switch';
import { SettingRow } from './SettingRow';
import { SettingsGroup } from './SettingsGroup';
import { settingsClient } from './client';
import { showToast } from '../../../ui/toast';
import { ErrorText } from '../../../ui/error-text';
import { errorMessage } from '../../../core/protocol/contract';

function snoozeUntil(kind: '30m' | '1h' | 'tomorrow'): string {
  const until = new Date();
  if (kind === '30m') until.setMinutes(until.getMinutes() + 30);
  else if (kind === '1h') until.setHours(until.getHours() + 1);
  else {
    until.setDate(until.getDate() + 1);
    until.setHours(9, 0, 0, 0);
  }
  return until.toISOString();
}

export function SystemNotifications() {
  const queryClient = useQueryClient();
  // 未读到当前状态（data 为 undefined）时开关保持禁用，避免闪烁出错误的默认值。
  const messageAlertsQuery = useQuery({
    queryKey: ['notifications', 'messageAlerts'],
    queryFn: () => notificationsClient.messageAlerts(),
    enabled: Boolean(window.dela),
  });
  const taskQuery = useQuery({
    queryKey: ['settings', 'taskNotifications'],
    queryFn: () => settingsClient.taskNotifications(),
    enabled: Boolean(window.dela),
  });
  const messageAlerts = messageAlertsQuery.data;
  const task = taskQuery.data;
  const loadError = messageAlertsQuery.error ?? taskQuery.error;
  const snoozedUntil = useNotificationState().data?.snoozedUntil ?? null;
  const subscriptions = useNotificationSubscriptions();
  const [busy, setBusy] = useState(false);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const toggleMessageAlerts = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const previous = messageAlerts;
    queryClient.setQueryData(['notifications', 'messageAlerts'], next);
    const save = async () => {
      queryClient.setQueryData(
        ['notifications', 'messageAlerts'],
        window.dela ? await notificationsClient.setMessageAlerts(next) : next,
      );
    };
    try {
      await save();
    } catch (cause) {
      queryClient.setQueryData(['notifications', 'messageAlerts'], previous);
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  const toggleTask = async (key: 'completed' | 'failed', next: boolean) => {
    if (busy || task === undefined) return;
    setBusy(true);
    const previous = task;
    queryClient.setQueryData(['settings', 'taskNotifications'], { ...task, [key]: next });
    const save = async () => {
      const saved = window.dela
        ? await settingsClient.setTaskNotifications({ ...task, [key]: next })
        : ({ ...task, [key]: next } satisfies TaskNotificationPrefs);
      queryClient.setQueryData(['settings', 'taskNotifications'], saved);
    };
    try {
      await save();
    } catch (cause) {
      queryClient.setQueryData(['settings', 'taskNotifications'], previous);
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  const changeSnooze = async (until: string | null) => {
    if (!window.dela) return;
    setBusy(true);
    const failureTitle = until === null ? '恢复通知失败' : '暂停通知失败';
    try {
      await notificationsClient.setSnooze(until);
    } catch (cause) {
      showToast({
        variant: 'error',
        title: failureTitle,
        description: errorMessage(cause),
      });
    }
    setBusy(false);
  };

  const toggleNoticeSubscriptions = async (enabled: boolean) => {
    setBusy(true);
    try {
      await notificationsClient.setNoticeSubscriptionsEnabled(enabled);
      await subscriptions.refetch();
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    // 导语只对本组成立，跟着组标题放在容器上方（容器底色承担分组边界）；
    // 「关闭≠停止收集」是防止用户以为关掉后会漏掉通知中心里的消息。
    <div className="grid gap-2">
      <SettingsGroup title="试验功能">
        <SettingRow settingId="experimental-notice-subscriptions" title="通用公告订阅">
          <Switch
            aria-label="通用公告订阅"
            checked={subscriptions.data?.experimental ?? false}
            disabled={!subscriptions.data || busy}
            onCheckedChange={(next) => void toggleNoticeSubscriptions(next)}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        description="关闭只停用桌面弹窗，通知中心仍会收集。"
        settingId="system-notifications"
        title="系统通知"
      >
        <SettingRow settingId="message-alerts" title="新消息提醒">
          <Switch
            checked={messageAlerts ?? true}
            disabled={messageAlerts === undefined || busy}
            aria-label="新消息提醒"
            onCheckedChange={(next) => void toggleMessageAlerts(next)}
          />
        </SettingRow>
        <SettingRow settingId="notify-run-failed" title="任务失败时提醒">
          <Switch
            checked={task?.failed ?? true}
            disabled={task === undefined || busy}
            aria-label="任务失败时提醒"
            onCheckedChange={(next) => void toggleTask('failed', next)}
          />
        </SettingRow>
        <SettingRow settingId="notify-run-completed" title="任务完成时提醒">
          <Switch
            checked={task?.completed ?? false}
            disabled={task === undefined || busy}
            aria-label="任务完成时提醒"
            onCheckedChange={(next) => void toggleTask('completed', next)}
          />
        </SettingRow>
        <SettingRow
          description={
            snoozedUntil ? (
              <span role="status">已暂停至 {new Date(snoozedUntil).toLocaleString('zh-CN')}</span>
            ) : undefined
          }
          settingId="snooze"
          title="暂停通知"
        >
          <div className="flex flex-wrap items-center gap-2">
            {window.dela ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void changeSnooze(snoozeUntil('30m'))}
                  size="sm"
                  variant="secondary"
                >
                  30 分钟
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void changeSnooze(snoozeUntil('1h'))}
                  size="sm"
                  variant="secondary"
                >
                  1 小时
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void changeSnooze(snoozeUntil('tomorrow'))}
                  size="sm"
                  variant="secondary"
                >
                  明早 9 点
                </Button>
                {snoozedUntil ? (
                  <Button
                    disabled={busy}
                    onClick={() => void changeSnooze(null)}
                    size="sm"
                    variant="ghost"
                  >
                    <BellOff />
                    恢复通知
                  </Button>
                ) : null}
              </>
            ) : (
              <span className="text-xs text-ink-3">暂停状态仅在桌面端可用。</span>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>
      {loadError && <ErrorText>{errorMessage(loadError)}</ErrorText>}
    </div>
  );
}
