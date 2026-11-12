// 设置页的 Skills 清单：内置与本机目录分开；每个本地项目各自成组，按 SKILL.md 路径开关，
// 同名 Skill 互不牵连；文档读取在装好组件前不能开启。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'dela-skills-'));
// 项目放在 home 之外：Pi 沿项目目录向上找 .agents/skills，不能撞上测试里的本机目录。
const projects = mkdtempSync(join(tmpdir(), 'dela-skill-projects-'));
let database: DatabaseSync;
vi.mock('electron', () => ({ app: { getPath: () => home }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) =>
    (
      database.prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value,
  writeSetting: (key: string, value: string) =>
    database.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, value),
}));

import { provideTestHostPorts } from '../../test/host-mock';
import { registerCommandDomain } from '../../../core/capabilities/commands';
import {
  effectiveDisabledSkills,
  listSkills,
  readDisabledSkillPaths,
  readDisabledSkills,
  setSkillEnabled,
} from '../skills';

function registerBuiltins(register: typeof registerCommandDomain) {
  for (const name of ['canvas', 'document-reading']) {
    const content = `---
name: ${name}
description: ${name} skill
---
`;
    register({
      name,
      description: name,
      skill: { name, files: [{ path: 'SKILL.md', content }] },
      commands: {},
    });
  }
}
registerBuiltins(registerCommandDomain);

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
  provideTestHostPorts({ paths: { userData: () => home, home: () => home } });
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, name TEXT, kind TEXT, local_path TEXT, remote_id TEXT);
  `);
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projects, { recursive: true, force: true });
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

  it('按项目列出 .agents/skills，同名 Skill 各自开关、不碰全局名单', async () => {
    const alpha = addProject('p-alpha', 'alpha');
    const beta = addProject('p-beta', 'beta');
    const alphaLint = writeSkill(join(alpha, '.agents', 'skills'), 'lint');
    writeSkill(join(beta, '.agents', 'skills'), 'lint');
    writeSkill(join(beta, '.agents', 'skills'), 'deploy');
    writeSkill(join(beta, '.pi', 'skills'), 'legacy');
    writeSkill(join(beta, '.agent', 'skills'), 'typo');

    const lint = await byName('lint');
    expect(lint.map((skill) => [skill.origin, skill.group?.label])).toEqual([
      ['project', 'alpha'],
      ['project', 'beta'],
    ]);
    expect((await byName('deploy'))[0]?.group).toEqual({ id: 'p-beta', label: 'beta' });
    expect([...(await byName('legacy')), ...(await byName('typo'))]).toEqual([]);

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

  it('只认清单里的 id，不接受任意路径', async () => {
    await expect(setSkillEnabled(join(home, 'elsewhere', 'SKILL.md'), false)).rejects.toThrow(
      'Skill 不存在',
    );
  });
});

it('restores user-edited builtin skills to the bundled version', async () => {
  const path = join(home, '.dela', 'skills', 'canvas', 'SKILL.md');
  const bundled = readFileSync(path, 'utf8');
  writeFileSync(path, `${bundled}\n用户补充的指引\n`);
  vi.resetModules();
  const { provideTestHostPorts: provideAfterReset } = await import('../../test/host-mock');
  provideAfterReset({ paths: { userData: () => home, home: () => home } });
  registerBuiltins((await import('../../../core/capabilities/commands')).registerCommandDomain);
  (await import('../skills')).ensureBuiltinSkills();
  expect(readFileSync(path, 'utf8')).toBe(bundled);
});
