// Skills：发现、加载与渐进注入由 Pi 完成（agentskills.io 规范）。这里只负责
// 把 Dela 内置的领域 skill 写进 ~/.dela/skills、给设置页列出可见 skill、维护禁用名单。
// 设置页按来处分组：内置、本机目录、Pi package、每个本地项目；后两者按 SKILL.md 路径开关。
import { app, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { SkillOrigin, SkillView } from '../../shared/capabilities';
import { getDatabase } from '../database';
import { experimentEnabled, readSetting, writeSetting } from '../settings/prefs';
import { discoverProjectSkills } from './discovery';
import { listPackages, packagesEnabled } from './packages';
import {
  DOCUMENT_SKILL,
  assertDocumentDependency,
  documentDependency,
  verifyDocumentRuntime,
} from '../documents/runtime';
import documentSkill from './skills/document-reading/SKILL.md?raw';
import documentScript from './skills/document-reading/scripts/read.py?raw';
import canvasSkill from './skills/canvas/SKILL.md?raw';
import classroomSkill from './skills/classroom/SKILL.md?raw';
import curriculumSkill from './skills/curriculum/SKILL.md?raw';
import mailSkill from './skills/mail/SKILL.md?raw';
import shuiyuanSkill from './skills/shuiyuan/SKILL.md?raw';
import todoSkill from './skills/todo/SKILL.md?raw';

const SKILL_ENTRY_FILE = 'SKILL.md';
const CAPABILITY_SETUP_KEY = 'capabilities-onboarding-completed';

export function needsCapabilitySetup(): boolean {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(CAPABILITY_SETUP_KEY) as { value: string } | undefined;
  return row?.value !== '1';
}

export function completeCapabilitySetup(): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(CAPABILITY_SETUP_KEY, '1');
}

/** 全局 Skill 根目录：~/.dela/skills（内置 Skill 随应用写入；用户自己的 Skill 也放这里）。 */
export function builtinSkillsDirectory(): string {
  return join(app.getPath('home'), '.dela', 'skills');
}

/** 本机全局 Skill 目录（与 Pi 的默认位置一致）；项目级的随会话 cwd 由 Pi 发现，见 discovery.ts。 */
export function globalSkillDirectories(): string[] {
  return [builtinSkillsDirectory(), join(app.getPath('home'), '.agents', 'skills')];
}

/** 内置 Skill 资产：./skills/<名字>/，正文教 agent 经 Bash 的 dela 命令操作（commands.ts）。 */
const BUILTIN_SKILLS: Readonly<Record<string, { path: string; content: string }[]>> = {
  [DOCUMENT_SKILL]: [
    { path: SKILL_ENTRY_FILE, content: documentSkill },
    { path: 'scripts/read.py', content: documentScript },
  ],
  shuiyuan: [{ path: SKILL_ENTRY_FILE, content: shuiyuanSkill }],
  canvas: [{ path: SKILL_ENTRY_FILE, content: canvasSkill }],
  classroom: [{ path: SKILL_ENTRY_FILE, content: classroomSkill }],
  mail: [{ path: SKILL_ENTRY_FILE, content: mailSkill }],
  todo: [{ path: SKILL_ENTRY_FILE, content: todoSkill }],
  curriculum: [{ path: SKILL_ENTRY_FILE, content: curriculumSkill }],
};

let builtinEnsured = false;
/**
 * 进程内首次使用时把内置 Skill 覆写到 ~/.dela/skills：正文与 dela 命令面强绑定，
 * 始终以应用内版本为准，用户对内置 Skill 的编辑会被还原（自定义请另建名字不同的 Skill）。
 * 先比后写：无变化不写盘，也避开文件被短暂占用时启动失败。
 */
export function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
  for (const [name, files] of Object.entries(BUILTIN_SKILLS))
    for (const file of files) {
      const path = join(builtinSkillsDirectory(), name, file.path);
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
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='skills-disabled'")
    .get() as { value: string } | undefined;
  const parsed = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : []);
  return new Set(parsed.success ? parsed.data : []);
}

/** 随功能开关隐藏的内置 Skill：水源关闭时既不注入 Agent，也不在设置页列出。 */
function featureHiddenSkills(): Set<string> {
  return new Set(experimentEnabled('shuiyuan') ? [] : ['shuiyuan']);
}

/** 注入 Pi 的禁用名单：用户禁用的 + 随功能关闭隐藏的（后者不写回用户名单）。 */
export function effectiveDisabledSkills(): Set<string> {
  const disabled = new Set([...readDisabledSkills(), ...featureHiddenSkills()]);
  if (documentDependency().status !== 'ready') disabled.add(DOCUMENT_SKILL);
  return disabled;
}

const DISABLED_PATHS_KEY = 'skills-disabled-paths';

/** 按 SKILL.md 路径停用的项目与包 Skill。 */
export function readDisabledSkillPaths(): Set<string> {
  try {
    const paths = z.array(z.string()).parse(JSON.parse(readSetting(DISABLED_PATHS_KEY) ?? '[]'));
    return new Set(paths.map((path) => resolve(path)));
  } catch {
    return new Set();
  }
}

function globalSkills(): SkillView[] {
  const disabled = readDisabledSkills();
  const hidden = featureHiddenSkills();
  const skills: SkillView[] = [];
  const seen = new Set<string>();
  for (const directory of globalSkillDirectories()) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name, SKILL_ENTRY_FILE);
      if (!entry.isDirectory() || seen.has(entry.name) || !existsSync(path)) continue;
      if (hidden.has(entry.name)) continue;
      seen.add(entry.name);
      const origin: SkillOrigin =
        directory === builtinSkillsDirectory() && entry.name in BUILTIN_SKILLS ? 'builtin' : 'user';
      skills.push({
        id: path,
        name: entry.name,
        description: description(path),
        enabled:
          !disabled.has(entry.name) &&
          (entry.name !== DOCUMENT_SKILL || documentDependency().status === 'ready'),
        path,
        origin,
        dependency: entry.name === DOCUMENT_SKILL ? documentDependency() : undefined,
      });
    }
  }
  return skills;
}

/** 已装的 Pi package 里的 Skill；总开关关闭时一个都不列（会话也不加载任何包）。 */
async function packageSkills(disabledPaths: Set<string>): Promise<SkillView[]> {
  if (!packagesEnabled()) return [];
  return (await listPackages()).flatMap((item) =>
    item.provides.skills.map((skill) => ({
      id: skill.path,
      name: skill.name,
      description: skill.description,
      path: skill.path,
      origin: 'package' as const,
      group: { id: item.id, label: item.name },
      enabled: item.enabled && item.resources.skills && !disabledPaths.has(skill.path),
      ...(!item.enabled
        ? { lockedReason: '所属包未启用' }
        : !item.resources.skills
          ? { lockedReason: '所属包关闭了 Skills' }
          : {}),
    })),
  );
}

/** 每个本地项目里 Pi 会加载的项目级 Skill。远程项目的 Skill 在打开会话时从远端镜像，不在这里列。 */
async function projectSkills(disabledPaths: Set<string>): Promise<SkillView[]> {
  const projects = getDatabase()
    .prepare(
      "SELECT id, name, local_path AS path FROM workspace_entries WHERE kind='project' AND remote_id IS NULL AND local_path IS NOT NULL ORDER BY name",
    )
    .all() as { id: string; name: string; path: string }[];
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
  const disabledPaths = readDisabledSkillPaths();
  const [packages, projects] = await Promise.all([
    packageSkills(disabledPaths),
    projectSkills(disabledPaths),
  ]);
  return [...globalSkills(), ...packages, ...projects];
}

/** 全局 Skill 按名称开关（内置的文档读取要先装好组件）。 */
export async function setGlobalSkillEnabled(name: string, enabled: boolean): Promise<void> {
  if (name === DOCUMENT_SKILL && enabled) {
    assertDocumentDependency();
    await verifyDocumentRuntime();
  }
  const disabled = readDisabledSkills();
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('skills-disabled', ?)")
    .run(JSON.stringify([...disabled]));
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillView[]> {
  const skill = await findSkill(id);
  if (skill.lockedReason) throw new Error(skill.lockedReason);
  if (skill.origin === 'package' || skill.origin === 'project') {
    const disabled = readDisabledSkillPaths();
    if (enabled) disabled.delete(skill.path);
    else disabled.add(skill.path);
    writeSetting(DISABLED_PATHS_KEY, JSON.stringify([...disabled]));
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
  shell.showItemInFolder((await findSkill(id)).path);
}

/** 技能目录（SKILL.md 所在目录）：上传到远端时按目录整体带走。 */
export function skillDirectory(skill: SkillView): string {
  return dirname(skill.path);
}
