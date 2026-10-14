// 内置 Skill 随功能开关隐藏：水源关闭时不在设置页列出、注入名单里带上它，且不写回用户禁用名单。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'dela-skills-'));
const flags = vi.hoisted(() => ({ shuiyuan: true }));
let database: DatabaseSync;
vi.mock('electron', () => ({ app: { getPath: () => home }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../storage', () => ({ storageDirectory: () => home }));
vi.mock('../../settings/prefs', () => ({
  experimentEnabled: (key: string) => key !== 'shuiyuan' || flags.shuiyuan,
}));
import { effectiveDisabledSkills, listSkills, readDisabledSkills } from '../skills';

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  flags.shuiyuan = true;
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

it('lists the shuiyuan skill only while the feature is enabled', () => {
  expect(listSkills().some((skill) => skill.name === 'shuiyuan')).toBe(true);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(false);
  flags.shuiyuan = false;
  expect(listSkills().some((skill) => skill.name === 'shuiyuan')).toBe(false);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(true);
  expect(readDisabledSkills().has('shuiyuan')).toBe(false);
});
