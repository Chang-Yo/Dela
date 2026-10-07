// 内置 Skill 拆分：campus 单体退役删除，五个领域 Skill（shuiyuan/canvas/mail/todo/
// curriculum）落盘 ~/.dela/skills；索引只含已启用项；正文经 dela 命令操作。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../../database';
import { listSkills, setSkillEnabled, skillIndex } from '../skills';

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-skills-'));
  getDatabase();
  // 退役清理只在进程内首次发现时执行：campus 目录须在第一次 listSkills 前预置。
  mkdirSync(join(state.root, '.dela', 'skills', 'campus'), { recursive: true });
  writeFileSync(
    join(state.root, '.dela', 'skills', 'campus', 'SKILL.md'),
    '---\nname: campus\n---\n旧单体',
    'utf8',
  );
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('内置 Skill 拆分', () => {
  it('首次发现写入五个领域 Skill，正文含 dela 命令指引', () => {
    const skills = listSkills().filter((skill) =>
      skill.path.startsWith(join(state.root, '.dela', 'skills')),
    );
    expect(skills.map(({ name }) => name).sort()).toEqual(
      ['canvas', 'curriculum', 'mail', 'shuiyuan', 'todo'].sort(),
    );
    for (const skill of skills) {
      expect(skill.enabled).toBe(true);
      expect(skill.description.length).toBeGreaterThan(0);
    }
    // 正文教 agent 用 dela 命令（pull 模型，ReadSkills 按需读正文）。
    expect(existsSync(join(state.root, '.dela', 'skills', 'shuiyuan', 'SKILL.md'))).toBe(true);
  });

  it('退役的 campus 目录在首次发现时被删除', () => {
    // campus 已在 beforeAll 预置，上面两例的首次 listSkills 已触发清理。
    expect(listSkills().some((skill) => skill.name === 'campus')).toBe(false);
    expect(existsSync(join(state.root, '.dela', 'skills', 'campus'))).toBe(false);
  });

  it('禁用后从索引消失，启用恢复', () => {
    setSkillEnabled('mail', false);
    expect(skillIndex().some((entry) => entry.name === 'mail')).toBe(false);
    setSkillEnabled('mail', true);
    expect(skillIndex().some((entry) => entry.name === 'mail')).toBe(true);
  });

  it('未知 Skill 启停抛错', () => {
    expect(() => setSkillEnabled('no-such-skill', false)).toThrow('Skill 不存在');
  });
});
