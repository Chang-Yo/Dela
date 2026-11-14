import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import type { TaskNotificationPrefs } from '../../../../modules/settings/contract';
import { notificationsClient, useNotificationState } from '../../../../modules/notifications/view';
import { Button } from '../../../../ui/button';
import { Switch } from '../../../../ui/switch';
import { SettingRow, SettingsGroup, settingsClient } from '../../../../modules/settings/view';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { ErrorText } from '../../../../ui/alert';

/** 暂停期限选项与通知中心一致（同一份 workspace_settings 暂停状态）。 */
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

/** 通用 › 系统通知；暂停状态与通知中心同源。 */
export function SystemNotifications() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [campus, setCampus] = useState<boolean | null>(null);
  const [task, setTask] = useState<TaskNotificationPrefs | null>(null);
  const snoozedUntil = useNotificationState().data?.snoozedUntil ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.dela) return;
    let active = true;
    void Promise.all([settingsClient.campusNotifications(), settingsClient.taskNotifications()])
      .then(([campusValue, taskValue]) => {
        if (!active) return;
        setCampus(campusValue);
        setTask(taskValue);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const toggleCampus = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const previous = campus;
    setCampus(next);
    try {
      setCampus(window.dela ? await settingsClient.setCampusNotifications(next) : next);
    } catch (cause) {
      setCampus(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (key: 'completed' | 'failed', next: boolean) => {
    if (busy || task === null) return;
    setBusy(true);
    const previous = task;
    setTask({ ...task, [key]: next });
    try {
      const saved = window.dela
        ? await settingsClient.setTaskNotifications({ ...task, [key]: next })
        : ({ ...task, [key]: next } satisfies TaskNotificationPrefs);
      setTask(saved);
    } catch (cause) {
      setTask(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const changeSnooze = async (until: string | null) => {
    if (!window.dela) return;
    setBusy(true);
    try {
      await notificationsClient.setSnooze(until);
    } catch (cause) {
      showToast({
        variant: 'error',
        title: until === null ? '恢复通知失败' : '暂停通知失败',
        description: errorText(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    // 导语只对本组成立，跟着组标题放在容器上方（容器底色承担分组边界）；
    // 「关闭≠停止收集」是防止用户以为关掉后会漏掉通知中心里的消息。
    <div className="grid gap-2">
      <SettingsGroup
        description="关闭只停用桌面弹窗，通知中心仍会收集。"
        settingId="system-notifications"
        title="系统通知"
      >
        <SettingRow settingId="campus-notifications" title="校园消息提醒">
          <Switch
            checked={campus ?? true}
            disabled={campus === null || busy}
            label="校园消息提醒"
            onChange={(next) => void toggleCampus(next)}
          />
        </SettingRow>
        <SettingRow settingId="notify-run-failed" title="任务失败时提醒">
          <Switch
            checked={task?.failed ?? true}
            disabled={task === null || busy}
            label="任务失败时提醒"
            onChange={(next) => void toggleTask('failed', next)}
          />
        </SettingRow>
        <SettingRow settingId="notify-run-completed" title="任务完成时提醒">
          <Switch
            checked={task?.completed ?? false}
            disabled={task === null || busy}
            label="任务完成时提醒"
            onChange={(next) => void toggleTask('completed', next)}
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
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
