// 项目级 Skill 发现：用 Pi 的 DefaultResourceLoader，与会话加载同一套规则。
import { resolve } from 'node:path';
import { isPiProjectSkill, loadPi, piAgentDir } from './pi';

export interface DiscoveredSkill {
  name: string;
  description: string;
  /** SKILL.md 的绝对路径。 */
  path: string;
}

/** 本地项目里 Pi 会加载的项目级 skills：与会话同一个 cwd、同样信任项目。 */
export async function discoverProjectSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const pi = await loadPi();
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: piAgentDir(),
    settingsManager: pi.SettingsManager.inMemory({}),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  return loader
    .getSkills()
    .skills.filter(
      (skill) => skill.sourceInfo.scope === 'project' && !isPiProjectSkill(skill.filePath, cwd),
    )
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: resolve(skill.filePath),
    }));
}
