// settings/prefs 的偏好读写：默认值回退、JSON 键损坏容错与部分合并语义。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../database', () => ({ getDatabase: () => database }));

import {
  getTaskNotificationPrefs,
  getWorkspacePrefs,
  savedCampusNotifications,
  setCampusNotifications,
  setTaskNotificationPrefs,
  setWorkspacePrefs,
} from '../prefs';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
});

describe('task notification prefs', () => {
  it('defaults to failed on / completed off', () => {
    expect(getTaskNotificationPrefs()).toEqual({ completed: false, failed: true });
  });

  it('round-trips saved prefs', () => {
    expect(setTaskNotificationPrefs({ completed: true, failed: false })).toEqual({
      completed: true,
      failed: false,
    });
    expect(getTaskNotificationPrefs()).toEqual({ completed: true, failed: false });
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('task-notifications', 'not-json')");
    expect(getTaskNotificationPrefs()).toEqual({ completed: false, failed: true });
  });

  it('rejects invalid shapes instead of persisting them', () => {
    expect(() => setTaskNotificationPrefs({ completed: 'yes' })).toThrow();
    expect(getTaskNotificationPrefs()).toEqual({ completed: false, failed: true });
  });
});

describe('campus notifications', () => {
  it('defaults to enabled and round-trips', () => {
    expect(savedCampusNotifications()).toBe(true);
    expect(setCampusNotifications(false)).toBe(false);
    expect(savedCampusNotifications()).toBe(false);
    expect(setCampusNotifications(true)).toBe(true);
    expect(savedCampusNotifications()).toBe(true);
  });
});

describe('workspace prefs', () => {
  it('defaults to restoring last project with rich editing', () => {
    expect(getWorkspacePrefs()).toEqual({ restoreLastProject: true, defaultNoteEditMode: 'rich' });
  });

  it('merges partial updates without touching other fields', () => {
    setWorkspacePrefs({ defaultNoteEditMode: 'source' });
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: true,
      defaultNoteEditMode: 'source',
    });
    setWorkspacePrefs({ restoreLastProject: false });
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: false,
      defaultNoteEditMode: 'source',
    });
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('workspace-prefs', 'broken-json')");
    expect(getWorkspacePrefs()).toEqual({ restoreLastProject: true, defaultNoteEditMode: 'rich' });
  });

  it('rejects invalid enum values', () => {
    expect(() => setWorkspacePrefs({ defaultNoteEditMode: 'wysiwyg' })).toThrow();
    expect(getWorkspacePrefs()).toEqual({ restoreLastProject: true, defaultNoteEditMode: 'rich' });
  });
});
