// 项目级 Skill 发现：用 Pi 的 DefaultResourceLoader，与会话加载同一套规则。
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isInside, loadPi, piAgentDir } from './pi';

/** Pi 认项目里的 .agents/skills（向上到 Git 根）与 .pi/skills；Dela 另外认项目根的 .agent/skills。 */
export function extraProjectSkillDirs(cwd: string): string[] {
  const dir = join(cwd, '.agent', 'skills');
  return existsSync(dir) ? [dir] : [];
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  /** SKILL.md 的绝对路径。 */
  path: string;
}

/** 本地项目里 Pi 会加载的项目级 skills：与会话同一个 cwd、同样信任项目。 */
export async function discoverProjectSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const pi = await loadPi();
  const extra = extraProjectSkillDirs(cwd);
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: piAgentDir(),
    settingsManager: pi.SettingsManager.inMemory({}),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: extra,
  });
  await loader.reload();
  return loader
    .getSkills()
    .skills.filter(
      (skill) =>
        skill.sourceInfo.scope === 'project' || extra.some((dir) => isInside(skill.filePath, dir)),
    )
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: resolve(skill.filePath),
    }));
}
