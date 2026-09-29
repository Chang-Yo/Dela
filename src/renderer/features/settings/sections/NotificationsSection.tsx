import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import type { NotificationState, TaskNotificationPrefs } from '../../../../shared/api';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { SectionHeader } from '../SectionHeader';
import { errorText } from '../../../workspace/store';

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

/** 设置 › 通知：校园消息与 Agent 任务的提醒偏好、暂停通知（与通知中心同一状态源）。 */
export function NotificationsSection() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [campus, setCampus] = useState<boolean | null>(null);
  const [task, setTask] = useState<TaskNotificationPrefs | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);
  const [snoozeActive, setSnoozeActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return;
    let active = true;
    void Promise.all([dela.settings.getCampusNotifications(), dela.settings.getTaskNotifications()])
      .then(([campusValue, taskValue]) => {
        if (!active) return;
        setCampus(campusValue);
        setTask(taskValue);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    // 暂停状态与通知中心共用：订阅广播，任意一端改动两端同步。
    void dela.notifications.getState().then((state) => setSnoozedUntil(state.snoozedUntil));
    const unsubscribe = dela.notifications.onUpdate((state: NotificationState) =>
      setSnoozedUntil(state.snoozedUntil),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // 暂停到期不自动刷新页面；展示前先按当前时间判断是否仍在暂停期。
  useEffect(() => {
    const check = () =>
      setSnoozeActive(Boolean(snoozedUntil && Date.parse(snoozedUntil) > Date.now()));
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [snoozedUntil]);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化。
  const toggleCampus = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const previous = campus;
    setCampus(next);
    try {
      setCampus(window.dela ? await window.dela.settings.setCampusNotifications(next) : next);
    } catch (cause) {
      setCampus(previous);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (key: 'completed' | 'failed', next: boolean) => {
    if (busy || task === null) return;
    setBusy(true);
    setError(null);
    const previous = task;
    setTask({ ...task, [key]: next });
    try {
      const saved = window.dela
        ? await window.dela.settings.setTaskNotifications({ ...task, [key]: next })
        : ({ ...task, [key]: next } satisfies TaskNotificationPrefs);
      setTask(saved);
    } catch (cause) {
      setTask(previous);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeSnooze = async (until: string | null) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    try {
      const state = await window.dela.notifications.setSnooze(until);
      setSnoozedUntil(state.snoozedUntil);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <SectionHeader description="校园消息与 Agent 任务的提醒偏好。" title="通知" />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="campus-notifications"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">校园消息系统提醒</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            新邮件与水源互动的桌面通知。关闭后不再弹出，但通知中心仍会收集全部消息。
          </p>
        </div>
        <div className="flex items-center justify-end">
          <Switch
            checked={campus ?? true}
            disabled={campus === null || busy}
            label="校园消息系统提醒"
            onChange={(next) => void toggleCampus(next)}
          />
        </div>
      </section>
      <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">Agent 任务通知</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            委托任务结束时的系统提醒；仅窗口未聚焦时弹出，关闭提醒不影响会话记录与侧栏状态。
          </p>
        </div>
        <div className="grid content-start gap-3">
          <div
            className="flex items-center justify-between gap-3"
            data-setting-id="notify-run-failed"
          >
            <span className="text-sm">任务失败时提醒</span>
            <Switch
              checked={task?.failed ?? true}
              disabled={task === null || busy}
              label="任务失败时提醒"
              onChange={(next) => void toggleTask('failed', next)}
            />
          </div>
          <div
            className="flex items-center justify-between gap-3"
            data-setting-id="notify-run-completed"
          >
            <span className="text-sm">任务完成时提醒</span>
            <Switch
              checked={task?.completed ?? false}
              disabled={task === null || busy}
              label="任务完成时提醒"
              onChange={(next) => void toggleTask('completed', next)}
            />
          </div>
        </div>
      </section>
      <section
        className="grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4"
        data-setting-id="snooze"
      >
        <div className="grid content-start gap-2">
          <h2 className="text-sm font-medium">暂停通知</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            暂停期间不弹任何系统提醒，通知仍会收集；与通知中心共用同一暂停状态。
          </p>
        </div>
        <div className="grid content-start gap-2">
          {snoozedUntil ? (
            <p className={snoozeActive ? 'text-xs text-muted-foreground' : 'sr-only'} role="status">
              {snoozeActive
                ? `已暂停至 ${new Date(snoozedUntil).toLocaleString('zh-CN')}`
                : '上次的暂停已到期。'}
            </p>
          ) : null}
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
              <p className="text-xs text-muted-foreground">暂停状态仅在桌面端可用。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
