// 内置 Skill 随功能开关隐藏：水源关闭时不在设置页列出、注入名单里带上它，且不写回用户禁用名单。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  completeCapabilitySetup,
  needsCapabilitySetup,
  effectiveDisabledSkills,
  listSkills,
  readDisabledSkills,
  setSkillEnabled,
} from '../skills';

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  flags.shuiyuan = true;
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

it('shows capability setup once without resetting existing skills or other onboarding settings', () => {
  database
    .prepare('INSERT INTO workspace_settings VALUES (?, ?)')
    .run('skills-disabled', '["mail"]');
  expect(needsCapabilitySetup()).toBe(true);
  expect(needsCapabilitySetup()).toBe(true);
  completeCapabilitySetup();
  expect(needsCapabilitySetup()).toBe(false);
  expect(readDisabledSkills().has('mail')).toBe(true);
  expect(
    database
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get('capabilities-onboarding-version'),
  ).toEqual({ value: '1' });
});

it('does not prompt after a newer setup version, but retries an invalid stored marker', () => {
  const write = database.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)');
  write.run('capabilities-onboarding-version', '2');
  expect(needsCapabilitySetup()).toBe(false);
  write.run('capabilities-onboarding-version', 'invalid');
  expect(needsCapabilitySetup()).toBe(true);
});

it('lists the shuiyuan skill only while the feature is enabled', () => {
  expect(listSkills().some((skill) => skill.name === 'shuiyuan')).toBe(true);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(false);
  flags.shuiyuan = false;
  expect(listSkills().some((skill) => skill.name === 'shuiyuan')).toBe(false);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(true);
  expect(readDisabledSkills().has('shuiyuan')).toBe(false);
});

it('writes the document skill but excludes it until its dependencies are installed', async () => {
  expect(listSkills().find((skill) => skill.name === 'document-reading')).toMatchObject({
    enabled: false,
    dependency: { status: 'missing' },
  });
  expect(effectiveDisabledSkills().has('document-reading')).toBe(true);
  await expect(setSkillEnabled('document-reading', true)).rejects.toThrow('安装文档读取组件');
  expect(listSkills().find((skill) => skill.name === 'document-reading')?.enabled).toBe(false);
});

it('upgrades the unmodified document skill while preserving user changes', async () => {
  const path = join(home, '.dela', 'skills', 'document-reading', 'SKILL.md');
  const current = readFileSync(path, 'utf8');
  const previous = current
    .split('\n')
    .filter((line) => !line.startsWith('网页 PDF：'))
    .join('\n')
    .replace('、邮件附件和 web_fetch 返回的 PDF 临时任务', '和邮件附件')
    .replace(/\n{3,}/g, '\n\n');
  writeFileSync(path, previous.replace(/\r?\n/g, '\r\n'));
  vi.resetModules();
  (await import('../skills')).ensureBuiltinSkills();
  expect(readFileSync(path, 'utf8')).toBe(current);
  const edited = previous + '\n用户补充的读取要求\n';
  writeFileSync(path, edited);
  vi.resetModules();
  (await import('../skills')).ensureBuiltinSkills();
  expect(readFileSync(path, 'utf8')).toBe(edited);
});
