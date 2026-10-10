// settings/prefs 的偏好读写：默认值回退、JSON 键损坏容错与部分合并语义。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../database', () => ({ getDatabase: () => database }));

import {
  getAgentInstruction,
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  getWorkspacePrefs,
  resetKeybindingOverrides,
  savedCampusNotifications,
  savedExperimentalClassroom,
  savedExperimentalFeatures,
  setAgentInstruction,
  setCampusNotifications,
  setExperimentalClassroom,
  setExperimentalFeatures,
  setKeybindingOverrides,
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

it('keeps experiments off for new or corrupt settings and persists an explicit opt-in', () => {
  expect(savedExperimentalFeatures()).toBe(false);
  insert("INSERT INTO workspace_settings VALUES ('experimental-features', 'broken')");
  expect(savedExperimentalFeatures()).toBe(false);
  setExperimentalFeatures(true);
  expect(savedExperimentalFeatures()).toBe(true);
  setExperimentalFeatures(false);
  expect(savedExperimentalFeatures()).toBe(false);
});

it('keeps the classroom sub-item on by default and round-trips an explicit opt-out', () => {
  // 子项缺省开启：总开关本身默认关，开启总开关即恢复子项可用。
  expect(savedExperimentalClassroom()).toBe(true);
  insert("INSERT INTO workspace_settings VALUES ('experimental-classroom', 'anything')");
  expect(savedExperimentalClassroom()).toBe(true);
  setExperimentalClassroom(false);
  expect(savedExperimentalClassroom()).toBe(false);
  setExperimentalClassroom(true);
  expect(savedExperimentalClassroom()).toBe(true);
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
  const defaults = { restoreLastProject: true, defaultNoteEditMode: 'rich', noteSpellcheck: false };

  it('defaults to restoring last project, rich editing and spellcheck off', () => {
    expect(getWorkspacePrefs()).toEqual(defaults);
  });

  it('fills the spellcheck field for prefs stored before it existed', () => {
    insert(
      'INSERT INTO workspace_settings VALUES (\'workspace-prefs\', \'{"restoreLastProject":false,"defaultNoteEditMode":"source"}\')',
    );
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: false,
      defaultNoteEditMode: 'source',
      noteSpellcheck: false,
    });
  });

  it('merges partial updates without touching other fields', () => {
    setWorkspacePrefs({ defaultNoteEditMode: 'source' });
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: true,
      defaultNoteEditMode: 'source',
      noteSpellcheck: false,
    });
    setWorkspacePrefs({ restoreLastProject: false });
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: false,
      defaultNoteEditMode: 'source',
      noteSpellcheck: false,
    });
    setWorkspacePrefs({ noteSpellcheck: true });
    expect(getWorkspacePrefs()).toEqual({
      restoreLastProject: false,
      defaultNoteEditMode: 'source',
      noteSpellcheck: true,
    });
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('workspace-prefs', 'broken-json')");
    expect(getWorkspacePrefs()).toEqual(defaults);
  });

  it('rejects invalid enum values', () => {
    expect(() => setWorkspacePrefs({ defaultNoteEditMode: 'wysiwyg' })).toThrow();
    expect(getWorkspacePrefs()).toEqual(defaults);
  });
});

describe('keybinding overrides', () => {
  it('defaults to no overrides', () => {
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('merges patches without touching stored actions', () => {
    expect(setKeybindingOverrides({ 'global-search': 'Mod+Shift+K' })).toEqual({
      'global-search': 'Mod+Shift+K',
    });
    expect(setKeybindingOverrides({ 'open-home': 'Mod+Shift+H' })).toEqual({
      'global-search': 'Mod+Shift+K',
      'open-home': 'Mod+Shift+H',
    });
    expect(getKeybindingOverrides()).toEqual({
      'global-search': 'Mod+Shift+K',
      'open-home': 'Mod+Shift+H',
    });
  });

  it('round-trips an explicit unbind', () => {
    expect(setKeybindingOverrides({ 'close-tab': null })).toEqual({ 'close-tab': null });
    expect(getKeybindingOverrides()).toEqual({ 'close-tab': null });
  });

  it('falls back to empty overrides on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('keybindings', 'not-json')");
    expect(getKeybindingOverrides()).toEqual({});
    // 'null' 能通过 JSON.parse 但不是覆盖项对象，读取路径同样不能抛错。
    insert("INSERT OR REPLACE INTO workspace_settings VALUES ('keybindings', 'null')");
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('drops unknown action ids and invalid accelerators inside stored JSON', () => {
    insert(
      `INSERT INTO workspace_settings VALUES ('keybindings', '{"not-an-action":"Mod+K","zoom-in":"Nope","open-mail":"Mod+2","close-tab":null}')`,
    );
    expect(getKeybindingOverrides()).toEqual({ 'open-mail': 'Mod+2', 'close-tab': null });
  });

  it('rejects unknown action ids and invalid accelerators instead of persisting them', () => {
    expect(() => setKeybindingOverrides({ 'not-an-action': 'Mod+K' })).toThrow();
    expect(() => setKeybindingOverrides({ 'zoom-in': 'Nope' })).toThrow();
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('reset clears every override', () => {
    setKeybindingOverrides({ 'zoom-in': 'Mod+Shift+=', 'close-tab': null });
    expect(resetKeybindingOverrides()).toEqual({});
    expect(getKeybindingOverrides()).toEqual({});
  });
});

describe('agent instruction', () => {
  it('defaults to empty so nothing is injected', () => {
    expect(getAgentInstruction()).toBe('');
  });

  it('round-trips text and trims surrounding whitespace', () => {
    expect(setAgentInstruction('  回答先给结论。  ')).toBe('回答先给结论。');
    expect(getAgentInstruction()).toBe('回答先给结论。');
  });

  it('rejects over-long text instead of persisting it', () => {
    expect(() => setAgentInstruction('x'.repeat(2001))).toThrow();
    expect(getAgentInstruction()).toBe('');
  });

  it('falls back to empty on corrupted or over-long stored values', () => {
    insert("INSERT INTO workspace_settings VALUES ('agent-instruction', ?)", 'y'.repeat(2001));
    expect(getAgentInstruction()).toBe('');
  });

  it('clearing writes an empty value that stays empty', () => {
    setAgentInstruction('先给结论。');
    expect(setAgentInstruction('')).toBe('');
    expect(getAgentInstruction()).toBe('');
  });
});
