// settings/prefs 的偏好读写：默认值回退、JSON 键损坏容错与部分合并语义。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../database', () => ({ getDatabase: () => database }));

import {
  getAgentInstruction,
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  normalizeFontSize,
  resetKeybindingOverrides,
  savedCampusNotifications,
  savedFontSize,
  savedOpenAtLogin,
  experimentEnabled,
  savedExperiments,
  savedPendingInstall,
  savedVideoDownloadDirectory,
  setAgentInstruction,
  setCampusNotifications,
  setExperiment,
  setKeybindingOverrides,
  setPendingInstall,
  setTaskNotificationPrefs,
  setVideoDownloadDirectory,
} from '../prefs';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
});

it('keeps experiments on for new or corrupt settings and persists an explicit opt-out', () => {
  expect(savedExperiments()).toEqual({ master: true, shuiyuan: true, videoDownload: true });
  insert("INSERT INTO workspace_settings VALUES ('experimental-features', 'broken')");
  expect(savedExperiments().master).toBe(true);
  expect(setExperiment('shuiyuan', false).shuiyuan).toBe(false);
  expect(setExperiment('shuiyuan', true).shuiyuan).toBe(true);
});

it('treats a sub-item as unavailable while the master switch is off', () => {
  expect(experimentEnabled('videoDownload')).toBe(true);
  setExperiment('master', false);
  expect(experimentEnabled('videoDownload')).toBe(false);
  expect(experimentEnabled('shuiyuan')).toBe(false);
  // 子项自身的选择保留，总开关重新打开后恢复。
  expect(savedExperiments().videoDownload).toBe(true);
  setExperiment('master', true);
  setExperiment('videoDownload', false);
  expect(experimentEnabled('videoDownload')).toBe(false);
  expect(experimentEnabled('shuiyuan')).toBe(true);
});

it('keeps login startup off unless the user opted in', () => {
  expect(savedOpenAtLogin()).toBe(false);
  insert("INSERT INTO workspace_settings VALUES ('open-at-login', '1')");
  expect(savedOpenAtLogin()).toBe(true);
  insert("INSERT OR REPLACE INTO workspace_settings VALUES ('open-at-login', '0')");
  expect(savedOpenAtLogin()).toBe(false);
});

describe('font size', () => {
  it('rounds and clamps any value into 12–20', () => {
    insert("INSERT INTO workspace_settings VALUES ('font-size', '17')");
    expect(savedFontSize()).toBe(17);
    insert("INSERT OR REPLACE INTO workspace_settings VALUES ('font-size', '9')");
    expect(savedFontSize()).toBe(12);
    insert("INSERT OR REPLACE INTO workspace_settings VALUES ('font-size', '64')");
    expect(savedFontSize()).toBe(20);
    insert("INSERT OR REPLACE INTO workspace_settings VALUES ('font-size', 'broken')");
    expect(savedFontSize()).toBe(16);
    expect(normalizeFontSize(13.4)).toBe(13);
    expect(normalizeFontSize(Number.NaN)).toBe(16);
  });

  it('uses the default when no font size is stored', () => {
    expect(savedFontSize()).toBe(16);
  });
});

describe('task notification prefs', () => {
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

describe('keybinding overrides', () => {
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

describe('classroom video download directory', () => {
  it('defaults to empty so the save dialog keeps its own default', () => {
    expect(savedVideoDownloadDirectory()).toBe('');
  });

  it('round-trips a chosen directory', () => {
    expect(setVideoDownloadDirectory('D:\\课堂录像')).toBe('D:\\课堂录像');
    expect(savedVideoDownloadDirectory()).toBe('D:\\课堂录像');
  });
});

describe('pending update install', () => {
  it('round-trips the deferred install flag', () => {
    expect(setPendingInstall(true)).toBe(true);
    expect(savedPendingInstall()).toBe(true);
    expect(setPendingInstall(false)).toBe(false);
    expect(savedPendingInstall()).toBe(false);
  });

  it('treats a corrupted value as nothing pending rather than trying to install', () => {
    insert("INSERT INTO workspace_settings VALUES ('pending-install', 'yes')");
    expect(savedPendingInstall()).toBe(false);
  });
});
