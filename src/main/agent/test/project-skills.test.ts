// 项目 Skill 在真实 Pi 会话里的加载与开关：.agents/skills 由 Pi 发现，.agent/skills 由 Dela 补上；
// 项目里的 Skill 按路径开关，全局名称名单只管全局 Skill，同名的项目 Skill 不受牵连。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'dela-project-skills-'));
vi.mock('electron', () => ({ app: { getPath: () => join(root, 'user-data') } }));

import { openPiSession } from '../pi';
import { extraProjectSkillDirs } from '../discovery';

afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeSkill(dir: string, name: string) {
  const path = join(dir, name, 'SKILL.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\n\nbody\n`);
  return path;
}

it('loads .agents and .agent project skills and keeps project toggles separate from global names', async () => {
  const project = join(root, 'project');
  const global = join(root, 'global-skills');
  writeSkill(join(project, '.agents', 'skills'), 'review');
  const agentDeploy = writeSkill(join(project, '.agent', 'skills'), 'deploy');
  writeSkill(join(project, '.agent', 'skills'), 'notes');
  writeSkill(global, 'calendar');

  const projectSkillDirs = extraProjectSkillDirs(project);
  const session = await openPiSession({
    cwd: project,
    selection: {
      provider: {
        id: 'p',
        name: 'mock',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'test-only',
        models: ['m'],
        presetId: null,
        enabled: true,
      },
      model: 'm',
      effort: null,
    },
    appendSystemPrompt: [],
    customTools: [],
    shellPath: process.env.SHELL ?? 'bash',
    skillPaths: [global, ...projectSkillDirs],
    globalSkillDirs: [global],
    // 全局名单里有 review 与 calendar：只应挡住全局的 calendar，项目里的 review 照常加载。
    disabledSkills: new Set(['review', 'calendar']),
    disabledSkillPaths: new Set([agentDeploy]),
    disabledTools: [],
  });
  try {
    const names = session.resourceLoader.getSkills().skills.map((skill) => skill.name);
    expect(names).toContain('review');
    expect(names).toContain('notes');
    expect(names).not.toContain('deploy');
    expect(names).not.toContain('calendar');
  } finally {
    session.dispose();
  }
});
