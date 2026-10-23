// 资源发现：用 Pi 自己的 DefaultResourceLoader 回答「某个项目、某组包里 Pi 会加载哪些 skills、
// prompt 模板与扩展能力」。设置页的清单与会话真正加载的是同一套规则，不另写一份扫描逻辑。
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PackageSource } from '@earendil-works/pi-coding-agent';
import type { PackageProvides } from '../../shared/packages';
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

const emptyProvides = (): PackageProvides => ({
  skills: [],
  prompts: [],
  commands: [],
  tools: [],
  mcpServers: [],
  extensionsInspected: false,
});

/**
 * 每个包提供了什么，按包来源串归档。skills 与 prompt 模板只是文件，所有已装好的包都列；
 * 命令、工具与 MCP 服务器要执行扩展代码才知道，只看启用且开了扩展的包（load 非空）：Pi 允许
 * 不建会话只加载扩展，工厂函数里不应启动进程。两个加载器都不信任项目，只看包本身。
 * 传进来的包必须已经装好：Pi 的加载器遇到缺失的 npm/git 来源会当场去装。
 */
export async function inventoryPackages(
  packages: { source: string; installedPath: string; load: PackageSource | null }[],
): Promise<{ provides: Map<string, PackageProvides>; errors: Map<string, string[]> }> {
  const pi = await loadPi();
  const provides = new Map<string, PackageProvides>();
  const errors = new Map<string, string[]>();
  const entry = (source: string) => {
    let item = provides.get(source);
    if (!item) provides.set(source, (item = emptyProvides()));
    return item;
  };
  const untrusted = (list: PackageSource[]) =>
    pi.SettingsManager.inMemory({ packages: list }, { projectTrusted: false });
  for (const item of packages) entry(item.source);

  if (packages.length) {
    const files = new pi.DefaultResourceLoader({
      cwd: piAgentDir(),
      agentDir: piAgentDir(),
      settingsManager: untrusted(packages.map((item) => item.source)),
      noExtensions: true,
      noThemes: true,
      noContextFiles: true,
    });
    await files.reload();
    for (const skill of files.getSkills().skills)
      if (skill.sourceInfo.origin === 'package')
        entry(skill.sourceInfo.source).skills.push({
          name: skill.name,
          description: skill.description,
          path: resolve(skill.filePath),
        });
    for (const prompt of files.getPrompts().prompts)
      if (prompt.sourceInfo.origin === 'package')
        entry(prompt.sourceInfo.source).prompts.push({
          name: prompt.name,
          description: prompt.description,
          ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
        });
  }

  const loadable = packages.filter((item) => item.load !== null);
  if (loadable.length) {
    const code = new pi.DefaultResourceLoader({
      cwd: piAgentDir(),
      agentDir: piAgentDir(),
      settingsManager: untrusted(loadable.map((item) => item.load!)),
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await code.reload();
    const loaded = code.getExtensions();
    const sourceOfPath = new Map<string, string>();
    for (const item of loadable) entry(item.source).extensionsInspected = true;
    for (const extension of loaded.extensions) {
      if (extension.sourceInfo.origin !== 'package') continue;
      const item = entry(extension.sourceInfo.source);
      sourceOfPath.set(extension.path, extension.sourceInfo.source);
      for (const command of extension.commands.values())
        item.commands.push({ name: command.name, description: command.description ?? '' });
      item.tools.push(...extension.tools.keys());
    }
    for (const server of loaded.runtime.mcpServers.list()) {
      const source = sourceOfPath.get(server.extensionPath);
      if (!source) continue;
      const config = server.config;
      entry(source).mcpServers.push({
        name: server.name,
        detail: 'url' in config ? config.url : [config.command, ...(config.args ?? [])].join(' '),
      });
    }
    // 加载期就失败的扩展不进运行时，只能按文件路径归到所在包的安装目录。
    for (const failure of loaded.errors) {
      const owner = loadable.find(
        (item) =>
          resolve(failure.path) === resolve(item.installedPath) ||
          isInside(failure.path, item.installedPath),
      );
      if (!owner) continue;
      errors.set(owner.source, [...(errors.get(owner.source) ?? []), failure.error]);
    }
  }
  return { provides, errors };
}
