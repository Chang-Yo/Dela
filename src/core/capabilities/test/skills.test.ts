import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'dela-skills-'));
// 项目放在 home 之外：Pi 沿项目目录向上找 .agents/skills，不能撞上测试里的本机目录。
const projects = mkdtempSync(join(tmpdir(), 'dela-skill-projects-'));
let database: DatabaseSync;
const localProjects: { id: string; name: string; path: string }[] = [];
const projectPort = { find: () => null, local: () => localProjects, remoteOf: () => null };
vi.mock('electron', () => ({ app: { getPath: () => home }, shell: {} }));

import { provideTestHostPorts } from '../../test/host-mock';
import { registerCommandDomain } from '../commands';
import { listSkills, readDisabledSkillPaths, readDisabledSkills, setSkillEnabled } from '../skills';

function registerBuiltins(register: typeof registerCommandDomain) {
  for (const name of ['canvas']) {
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
  localProjects.push({ id, name, path });
  return path;
}

const byName = async (name: string) => (await listSkills()).filter((skill) => skill.name === name);

beforeEach(() => {
  provideTestHostPorts({
    paths: { userData: () => home, home: () => home },
    database: () => database as never,
    projects: projectPort,
  });
  database = new DatabaseSync(':memory:');
  localProjects.length = 0;
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projects, { recursive: true, force: true });
});

describe('分组', () => {
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
  provideAfterReset({
    paths: { userData: () => home, home: () => home },
    database: () => database as never,
    projects: projectPort,
  });
  registerBuiltins((await import('../commands')).registerCommandDomain);
  (await import('../skills')).ensureBuiltinSkills();
  expect(readFileSync(path, 'utf8')).toBe(bundled);
});
