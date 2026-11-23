import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../../notifications', () => ({ systemNotifyToast: vi.fn() }));

import { coreSchema } from '../../../../core/data/schema';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { systemNotifyToast } from '../../../notifications';
import { notifyRunFinished } from '../task-notify';
import { setTaskNotificationPrefs } from '../prefs';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

provideTestHostPorts({ database: () => database as never });

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  for (const table of coreSchema.tables) database.exec(table);
  insert(
    "INSERT INTO sessions (id, file, title, created_at, updated_at) VALUES ('session-1', '', '整理复习计划', '', '')",
  );
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
});
