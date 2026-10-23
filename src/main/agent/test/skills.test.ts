// 设置页的 Skills 清单：内置与本机目录分开；Pi package 与每个本地项目各自成组，按 SKILL.md 路径开关，
// 同名 Skill 互不牵连；水源随功能开关隐藏；文档读取在装好组件前不能开启。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiPackageView } from '../../../shared/packages';

const home = mkdtempSync(join(tmpdir(), 'dela-skills-'));
// 项目放在 home 之外：Pi 沿项目目录向上找 .agents/skills，不能撞上测试里的本机目录。
const projects = mkdtempSync(join(tmpdir(), 'dela-skill-projects-'));
const state = vi.hoisted(() => ({
  shuiyuan: true,
  packagesOn: true,
  packages: [] as PiPackageView[],
}));
let database: DatabaseSync;
vi.mock('electron', () => ({ app: { getPath: () => home }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../settings/prefs', () => ({
  experimentEnabled: (key: string) => key !== 'shuiyuan' || state.shuiyuan,
  readSetting: (key: string) =>
    (
      database.prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value,
  writeSetting: (key: string, value: string) =>
    database.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, value),
}));
vi.mock('../packages', () => ({
  packagesEnabled: () => state.packagesOn,
  listPackages: async () => state.packages,
}));
import {
  completeCapabilitySetup,
  needsCapabilitySetup,
  effectiveDisabledSkills,
  listSkills,
  readDisabledSkillPaths,
  readDisabledSkills,
  setSkillEnabled,
} from '../skills';

function writeSkill(dir: string, name: string) {
  const path = join(dir, name, 'SKILL.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\n\nbody\n`);
  return path;
}

function addProject(id: string, name: string) {
  const path = join(projects, name);
  mkdirSync(path, { recursive: true });
  database
    .prepare(
      "INSERT INTO workspace_entries (id, name, kind, local_path, remote_id) VALUES (?, ?, 'project', ?, NULL)",
    )
    .run(id, name, path);
  return path;
}

const byName = async (name: string) => (await listSkills()).filter((skill) => skill.name === name);

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, name TEXT, kind TEXT, local_path TEXT, remote_id TEXT);
  `);
  state.shuiyuan = true;
  state.packagesOn = true;
  state.packages = [];
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projects, { recursive: true, force: true });
});

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
  ).toEqual({ value: '2' });
});

it('shows the capability page again to users who finished version 1 (before Pi Packages)', () => {
  database
    .prepare('INSERT INTO workspace_settings VALUES (?, ?)')
    .run('capabilities-onboarding-version', '1');
  expect(needsCapabilitySetup()).toBe(true);
});

it('does not prompt after a newer setup version, but retries an invalid stored marker', () => {
  const write = database.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)');
  write.run('capabilities-onboarding-version', '3');
  expect(needsCapabilitySetup()).toBe(false);
  write.run('capabilities-onboarding-version', 'invalid');
  expect(needsCapabilitySetup()).toBe(true);
});

it('lists the shuiyuan skill only while the feature is enabled', async () => {
  expect(await byName('shuiyuan')).toHaveLength(1);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(false);
  state.shuiyuan = false;
  expect(await byName('shuiyuan')).toHaveLength(0);
  expect(effectiveDisabledSkills().has('shuiyuan')).toBe(true);
  expect(readDisabledSkills().has('shuiyuan')).toBe(false);
});

it('writes the document skill but excludes it until its dependencies are installed', async () => {
  const [document] = await byName('document-reading');
  expect(document).toMatchObject({ enabled: false, dependency: { status: 'missing' } });
  expect(effectiveDisabledSkills().has('document-reading')).toBe(true);
  await expect(setSkillEnabled(document!.id, true)).rejects.toThrow('安装文档读取组件');
  expect((await byName('document-reading'))[0]?.enabled).toBe(false);
});

describe('分组', () => {
  it('分开 Dela 内置与本机目录里用户自己放的', async () => {
    writeSkill(join(home, '.dela', 'skills'), 'my-notes');
    writeSkill(join(home, '.agents', 'skills'), 'from-agents');
    const skills = await listSkills();
    const origin = (name: string) => skills.find((skill) => skill.name === name)?.origin;
    expect(origin('canvas')).toBe('builtin');
    expect(origin('my-notes')).toBe('user');
    expect(origin('from-agents')).toBe('user');
  });

  it('按项目列出 .agents/skills 与 .agent/skills，同名 Skill 各自开关、不碰全局名单', async () => {
    const alpha = addProject('p-alpha', 'alpha');
    const beta = addProject('p-beta', 'beta');
    const alphaLint = writeSkill(join(alpha, '.agents', 'skills'), 'lint');
    writeSkill(join(beta, '.agent', 'skills'), 'lint');
    writeSkill(join(beta, '.agents', 'skills'), 'deploy');

    const lint = await byName('lint');
    expect(lint.map((skill) => [skill.origin, skill.group?.label])).toEqual([
      ['project', 'alpha'],
      ['project', 'beta'],
    ]);
    expect((await byName('deploy'))[0]?.group).toEqual({ id: 'p-beta', label: 'beta' });

    await setSkillEnabled(lint[0]!.id, false);
    const after = await byName('lint');
    expect(after.map((skill) => skill.enabled)).toEqual([false, true]);
    expect([...readDisabledSkillPaths()]).toEqual([alphaLint]);
    expect(readDisabledSkills().has('lint')).toBe(false);
  });

  it('远程项目与目录已不在的项目不列', async () => {
    database
      .prepare(
        "INSERT INTO workspace_entries (id, name, kind, local_path, remote_id) VALUES ('p-r', 'remote', 'project', '/root/proj', 'r-1')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO workspace_entries (id, name, kind, local_path, remote_id) VALUES ('p-gone', 'gone', 'project', ?, NULL)",
      )
      .run(join(projects, 'missing'));
    expect((await listSkills()).filter((skill) => skill.origin === 'project')).toEqual([]);
  });

  it('Pi package 的 Skill 跟着包的启停：包未启用时只读，启用后按路径开关', async () => {
    const path = join(home, 'pkg', 'skills', 'research', 'SKILL.md');
    const pkg = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'autoresearch',
      enabled: false,
      resources: { extensions: true, skills: true, prompts: true },
      provides: {
        skills: [{ name: 'research', description: 'Deep research', path }],
        prompts: [],
        commands: [],
        tools: [],
        mcpServers: [],
        extensionsInspected: false,
      },
    } as unknown as PiPackageView;
    state.packages = [pkg];
    const [locked] = await byName('research');
    expect(locked).toMatchObject({
      origin: 'package',
      group: { label: 'autoresearch' },
      enabled: false,
      lockedReason: '所属包未启用',
    });
    await expect(setSkillEnabled(locked!.id, true)).rejects.toThrow('所属包未启用');

    state.packages = [{ ...pkg, enabled: true }];
    const [enabled] = await byName('research');
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.lockedReason).toBeUndefined();
    await setSkillEnabled(path, false);
    expect((await byName('research'))[0]?.enabled).toBe(false);

    // 总开关关掉：包一个都不加载，也就不列它们的 Skill。
    state.packagesOn = false;
    expect(await byName('research')).toEqual([]);
  });

  it('只认清单里的 id，不接受任意路径', async () => {
    await expect(setSkillEnabled(join(home, 'elsewhere', 'SKILL.md'), false)).rejects.toThrow(
      'Skill 不存在',
    );
  });
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
