// Run 终态通知的偏好门控：completed/failed 各自按开关决定是否弹系统提醒。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../notifications/system', () => ({ systemNotifyToast: vi.fn() }));

import { systemNotifyToast } from '../../notifications/system';
import { notifyRunFinished } from '../task-notify';
import { setTaskNotificationPrefs } from '../prefs';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
  `);
  insert("INSERT INTO sessions VALUES ('session-1', '整理复习计划')");
  vi.mocked(systemNotifyToast).mockClear();
});

describe('notifyRunFinished', () => {
  it('notifies on failure by default and includes the session title', () => {
    notifyRunFinished('session-1', 'failed');
    expect(systemNotifyToast).toHaveBeenCalledWith('任务失败', '整理复习计划');
  });

  it('does not notify on completion by default (low-noise default)', () => {
    notifyRunFinished('session-1', 'completed');
    expect(systemNotifyToast).not.toHaveBeenCalled();
  });

  it('respects the completed switch once enabled', () => {
    setTaskNotificationPrefs({ completed: true, failed: true });
    notifyRunFinished('session-1', 'completed');
    expect(systemNotifyToast).toHaveBeenCalledWith('任务完成', '整理复习计划');
  });

  it('stays silent when the failed switch is off', () => {
    setTaskNotificationPrefs({ completed: false, failed: false });
    notifyRunFinished('session-1', 'failed');
    expect(systemNotifyToast).not.toHaveBeenCalled();
  });

  it('falls back to a generic body for unknown sessions', () => {
    notifyRunFinished('missing', 'failed');
    expect(systemNotifyToast).toHaveBeenCalledWith('任务失败', 'Dela 会话');
  });
});
