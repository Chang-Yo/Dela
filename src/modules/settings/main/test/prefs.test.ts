// settings/prefs：存储值损坏时回退默认，非法输入在契约边界被拒绝。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

let database: DatabaseSync;

import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { getAgentInstruction, setAgentInstruction } from '../../../../core/agent/instruction';
import { settingsContract } from '../../contract';
import {
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  normalizeFontSize,
  savedFontSize,
  savedPendingInstall,
} from '../prefs';

provideTestHostPorts({ database: () => database as never });

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
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
});

describe('task notification prefs', () => {
  it('falls back to defaults on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('task-notifications', 'not-json')");
    expect(getTaskNotificationPrefs()).toEqual({ completed: false, failed: true });
  });

  it('rejects invalid shapes instead of persisting them', () => {
    const input = settingsContract.procedures.setTaskNotifications.input;
    expect(() => input.parse({ completed: 'yes' })).toThrow();
    expect(getTaskNotificationPrefs()).toEqual({ completed: false, failed: true });
  });
});

describe('keybinding overrides', () => {
  it('falls back to empty overrides on corrupt stored JSON', () => {
    insert("INSERT INTO workspace_settings VALUES ('keybindings', 'not-json')");
    expect(getKeybindingOverrides()).toEqual({});
    // 'null' 能通过 JSON.parse 但不是覆盖项对象，读取路径同样不能抛错。
    insert("INSERT OR REPLACE INTO workspace_settings VALUES ('keybindings', 'null')");
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('drops unknown action ids and invalid accelerators inside stored JSON', () => {
    insert(
      `INSERT INTO workspace_settings VALUES ('keybindings', '{"not-an-action":"Mod+K","zoom-in":"Nope","open-settings":"Mod+J","close-tab":null}')`,
    );
    expect(getKeybindingOverrides()).toEqual({ 'open-settings': 'Mod+J', 'close-tab': null });
  });

  it('rejects unknown action ids and invalid accelerators instead of persisting them', () => {
    const input = settingsContract.procedures.setKeybindings.input;
    expect(() => input.parse({ 'not-an-action': 'Mod+K' })).toThrow();
    expect(() => input.parse({ 'zoom-in': 'Nope' })).toThrow();
    expect(getKeybindingOverrides()).toEqual({});
  });
});

describe('agent instruction', () => {
  it('rejects over-long text instead of persisting it', () => {
    expect(() => setAgentInstruction('x'.repeat(2001))).toThrow();
    expect(getAgentInstruction()).toBe('');
  });

  it('falls back to empty on corrupted or over-long stored values', () => {
    insert("INSERT INTO workspace_settings VALUES ('agent-instruction', ?)", 'y'.repeat(2001));
    expect(getAgentInstruction()).toBe('');
  });
});

describe('pending update install', () => {
  it('treats a corrupted value as nothing pending rather than trying to install', () => {
    insert("INSERT INTO workspace_settings VALUES ('pending-install', 'yes')");
    expect(savedPendingInstall()).toBe(false);
  });
});
