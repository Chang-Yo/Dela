// Skills：发现、加载与渐进注入由 Pi 完成（agentskills.io 规范）。这里只负责
// 把 Dela 内置的领域 skill 写进 ~/.dela/skills、给设置页列出可见 skill、维护禁用名单。
// 设置页按来处分组：内置、本机目录、每个本地项目；项目的按 SKILL.md 路径开关。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { SkillOrigin, SkillView } from '../../shared/capabilities';
import { discoverProjectSkills } from './discovery';
import { documentReader, readyDocumentReader } from './documents';
import { hostPorts } from '../host';
import { builtinSkills } from '../../core/capabilities/commands';

const SKILL_ENTRY_FILE = 'SKILL.md';

/** 全局 Skill 根目录：~/.dela/skills（内置 Skill 随应用写入；用户自己的 Skill 也放这里）。 */
export function builtinSkillsDirectory(): string {
  return join(hostPorts().paths.home(), '.dela', 'skills');
}

/** 本机全局 Skill 目录（与 Pi 的默认位置一致）；项目级的随会话 cwd 由 Pi 发现，见 discovery.ts。 */
export function globalSkillDirectories(): string[] {
  return [builtinSkillsDirectory(), join(hostPorts().paths.home(), '.agents', 'skills')];
}

let builtinEnsured = false;
/**
 * 进程内首次使用时把内置 Skill 覆写到 ~/.dela/skills：正文与 dela 命令面强绑定，
 * 始终以应用内版本为准，用户对内置 Skill 的编辑会被还原（自定义请另建名字不同的 Skill）。
 * 先比后写：无变化不写盘，也避开文件被短暂占用时启动失败。
 */
export function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
  for (const skill of builtinSkills())
    for (const file of skill.files) {
      const path = join(builtinSkillsDirectory(), skill.name, file.path);
      if (existsSync(path) && readFileSync(path, 'utf8') === file.content) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content, 'utf8');
    }
}

function description(path: string): string {
  const match = /^description:\s*(.*)$/m.exec(readFileSync(path, 'utf8'));
  return match?.[1]?.trim() ?? '';
}

export function readDisabledSkills(): Set<string> {
  const row = hostPorts()
    .database()
    .prepare("SELECT value FROM workspace_settings WHERE key='skills-disabled'")
    .get() as { value: string } | undefined;
  const parsed = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : []);
  return new Set(parsed.success ? parsed.data : []);
}

export function effectiveDisabledSkills(): Set<string> {
  const disabled = readDisabledSkills();
  const reader = documentReader();
  if (reader && reader.dependency().status !== 'ready') disabled.add(reader.skill);
  return disabled;
}

const DISABLED_PATHS_KEY = 'skills-disabled-paths';

/** 按 SKILL.md 路径停用的项目 Skill。 */
export function readDisabledSkillPaths(): Set<string> {
  try {
    const row = hostPorts()
      .database()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(DISABLED_PATHS_KEY) as { value: string } | undefined;
    const paths = z.array(z.string()).parse(JSON.parse(row?.value ?? '[]'));
    return new Set(paths.map((path) => resolve(path)));
  } catch {
    return new Set();
  }
}

function globalSkills(): SkillView[] {
  const disabled = readDisabledSkills();
  const skills: SkillView[] = [];
  const seen = new Set<string>();
  const builtin = new Set(builtinSkills().map((skill) => skill.name));
  const reader = documentReader();
  for (const directory of globalSkillDirectories()) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name, SKILL_ENTRY_FILE);
      if (!entry.isDirectory() || seen.has(entry.name) || !existsSync(path)) continue;
      seen.add(entry.name);
      const origin: SkillOrigin =
        directory === builtinSkillsDirectory() && builtin.has(entry.name) ? 'builtin' : 'user';
      skills.push({
        id: path,
        name: entry.name,
        description: description(path),
        enabled:
          !disabled.has(entry.name) &&
          (entry.name !== reader?.skill || reader.dependency().status === 'ready'),
        path,
        origin,
        dependency: entry.name === reader?.skill ? reader.dependency() : undefined,
      });
    }
  }
  return skills;
}

/** 每个本地项目里 Pi 会加载的项目级 Skill。远程项目的 Skill 在打开会话时从远端镜像，不在这里列。 */
async function projectSkills(disabledPaths: Set<string>): Promise<SkillView[]> {
  const projects = hostPorts().projects.local();
  const lists = await Promise.all(
    projects
      .filter((project) => existsSync(project.path))
      .map(async (project) =>
        (await discoverProjectSkills(project.path)).map((skill) => ({
          id: skill.path,
          name: skill.name,
          description: skill.description,
          path: skill.path,
          origin: 'project' as const,
          group: { id: project.id, label: project.name },
          enabled: !disabledPaths.has(skill.path),
        })),
      ),
  );
  return lists.flat();
}

export async function listSkills(): Promise<SkillView[]> {
  ensureBuiltinSkills();
  return [...globalSkills(), ...(await projectSkills(readDisabledSkillPaths()))];
}

/** 全局 Skill 按名称开关（内置的文档读取要先装好组件）。 */
export async function setGlobalSkillEnabled(name: string, enabled: boolean): Promise<void> {
  if (name === documentReader()?.skill && enabled) await readyDocumentReader().verify();
  const disabled = readDisabledSkills();
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  hostPorts()
    .database()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('skills-disabled', ?)")
    .run(JSON.stringify([...disabled]));
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillView[]> {
  const skill = await findSkill(id);
  if (skill.origin === 'project') {
    const disabled = readDisabledSkillPaths();
    if (enabled) disabled.delete(skill.path);
    else disabled.add(skill.path);
    hostPorts()
      .database()
      .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
      .run(DISABLED_PATHS_KEY, JSON.stringify([...disabled]));
  } else await setGlobalSkillEnabled(skill.name, enabled);
  return listSkills();
}

/** 按清单解析再读文件：渲染端传来的 id 必须是清单里的某一项，主进程不读清单外的路径。 */
export async function findSkill(id: string): Promise<SkillView> {
  const skill = (await listSkills()).find((item) => item.id === id);
  if (!skill) throw new Error('Skill 不存在或已被移除');
  return skill;
}

export async function readSkill(id: string): Promise<string> {
  return readFileSync((await findSkill(id)).path, 'utf8');
}

export async function revealSkill(id: string): Promise<void> {
  hostPorts().desktop.reveal((await findSkill(id)).path);
}

/** 技能目录（SKILL.md 所在目录）：上传到远端时按目录整体带走。 */
export function skillDirectory(skill: SkillView): string {
  return dirname(skill.path);
}
