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
import documentSkill from '../documents/skill/SKILL.md?raw';
import documentScript from '../documents/skill/scripts/read.py?raw';

const SKILL_ENTRY_FILE = 'SKILL.md';
// 2：能力拓展页加入 Pi Packages，老用户升级后再看一次。
const CAPABILITY_SETUP_VERSION = 2;
const CAPABILITY_SETUP_KEY = 'capabilities-onboarding-version';

export function needsCapabilitySetup(): boolean {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(CAPABILITY_SETUP_KEY) as { value: string } | undefined;
  const version = Number(row?.value ?? 0);
  return !Number.isFinite(version) || version < CAPABILITY_SETUP_VERSION;
}

export function completeCapabilitySetup(): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(CAPABILITY_SETUP_KEY, String(CAPABILITY_SETUP_VERSION));
}

/** 全局 Skill 根目录：~/.dela/skills（内置 Skill 随应用写入；用户自己的 Skill 也放这里）。 */
export function builtinSkillsDirectory(): string {
  return join(app.getPath('home'), '.dela', 'skills');
}

/** 本机全局 Skill 目录（与 Pi 的默认位置一致）；项目级的随会话 cwd 由 Pi 发现，见 discovery.ts。 */
export function globalSkillDirectories(): string[] {
  return [builtinSkillsDirectory(), join(app.getPath('home'), '.agents', 'skills')];
}

/** 内置 Skill 正文：领域知识按业务拆分，正文教 agent 经 Bash 的 dela 命令操作（commands.ts）。 */
const BUILTIN_SKILLS: Readonly<Record<string, string>> = {
  [DOCUMENT_SKILL]: documentSkill,
  shuiyuan: `---
name: shuiyuan
description: 上海交大水源社区（BBS）：搜索与浏览话题、读帖子正文、把帖子关联进项目
---

# 水源社区

水源是交大校园论坛。搜索讨论、查看帖子时用本 Skill。

## 命令（Bash 内 dela）

- \`dela shuiyuan_status '{}'\`：连接与登录状态
- \`dela search_shuiyuan_topics '{"query":"关键词"}'\`：搜索话题
- \`dela list_shuiyuan_topics\`：按分类/最新浏览话题（支持分页）
- \`dela list_shuiyuan_categories '{}'\`：分类与站点结构
- \`dela read_shuiyuan_topic\` / \`dela read_shuiyuan_posts\`：话题正文与楼层
- \`dela link_shuiyuan_topic\`：把话题作为来源引用加入项目

## 指引

- 帖子正文返回 HTML，引用与图片链接保留原始标记
- 断网时读取会回退本地缓存摘要，结果带 degraded 标注，需向用户说明内容不完整
- 讨论结论值得沉淀时，用 link_shuiyuan_topic 关联进项目，或把要点写进项目笔记
- 通用：\`dela help\` 查看全部命令与参数；不确定就先 help，不要猜测
`,
  canvas: `---
name: canvas
description: Canvas 课程平台：课程与资料检索、作业要求阅读、把课件与资料关联进项目
---

# Canvas 课程资料

课程文件、实验要求、公告等教学资料在 Canvas。查资料、读课件时用本 Skill。

## 命令（Bash 内 dela）

- \`dela get_canvas_status '{}'\`：连接状态
- \`dela list_canvas_courses '{}'\`：已缓存课程列表
- \`dela search_canvas_sources '{"query":"实验"}'\`：按标题搜课程资料
- \`dela refresh_canvas_courses\` / \`dela refresh_canvas_course\`：同步课程（先同步后搜索）
- \`dela read_resource '{"ref":{"type":"canvas","id":"file:123"}}'\`：读资料页面正文；文件正文使用 document-reading Skill
- \`dela link_canvas_source\`：把资料作为来源引用加入项目
- \`dela copy_file_to_project\`：把资料复制为项目文件，长期使用

## 指引

- 只匹配缓存标题；先确认状态已连接、课程已同步
- 实验报告、大作业的要求文档读完后，把要点整理进项目笔记，课件用 link 或 copy 挂进项目
- 作业截止时间见 TODO（query_assignments）；到期日可用 curriculum 的 create_event 写入日历
- 通用：\`dela help\` 查看全部命令与参数；不确定就先 help，不要猜测
`,
  mail: `---
name: mail
description: 交大邮箱：搜索邮件、读正文与附件、准备邮件草稿
---

# 邮箱

邮件经学校邮箱账号收发，登录会话由应用保存。

## 命令（Bash 内 dela）

- \`dela search_mail '{"query":"成绩单","limit":20}'\`：搜索邮件（按文件夹/日期过滤）
- \`dela list_mail_folders '{}'\`：文件夹与同步状态
- \`dela read_resource '{"ref":{"type":"mail","id":123}}'\`：读邮件正文（分页）
- 附件：ref 用 \`{"type":"attachment","messageId":123,"part":"..."}\`；用 document-reading Skill 读取文件正文
- \`dela prepare_email\`：准备邮件草稿（收件人/主题/正文），草稿在应用邮件编辑器中由用户发送

## 指引

- 邮件是不可变资料；正文缺失时读取会按需联网补齐
- 需要用户过目的回复先 prepare_email 成草稿，不代替用户发送
- 附件只临时提取不留存；要长期使用先 copy_file_to_project 导入项目
- 通用：\`dela help\` 查看全部命令与参数；不确定就先 help，不要猜测
`,
  todo: `---
name: todo
description: 待办与 Canvas 作业：查询、创建、完成个人待办，跟踪作业提交状态与截止时间
---

# 待办与作业

个人待办与 Canvas 作业统一在 TODO 列表。

## 命令（Bash 内 dela）

- \`dela query_todos '{}'\`：个人待办（含已完成开关）
- \`dela query_assignments '{}'\`：Canvas 作业与提交状态（按课程过滤）
- \`dela save_todo\`：创建/更新待办（标题、备注、截止时间）
- \`dela remove_todo\`：删除个人待办
- \`dela refresh_todos '{}'\`：手动同步作业

## 指引

- Canvas 作业只读：区分未完成、已提交、已批改、豁免、需重交；提交要在 Canvas 完成
- 作业描述是 HTML，读取时返回剥离正文（query_assignments 返回 id，正文经 canvas 命令的资料读取获得）
- 截止时间临近需要提醒时，用 curriculum 的 create_event 写入日历
- 通用：\`dela help\` 查看全部命令与参数；不确定就先 help，不要猜测
`,
  curriculum: `---
name: curriculum
description: 课表与日程：查询课程安排、创建与管理日历事件
---

# 课表与日程

课表来自教务系统，日程存本地日历。

## 命令（Bash 内 dela）

- \`dela get_timetable_status '{}'\`：同步状态与当前学期
- \`dela query_schedule\`：按周/日期查课表与日程
- \`dela refresh_timetable '{}'\`：同步课表
- \`dela create_event\`：创建日历事件（标题、开始、结束、地点、颜色）
- \`dela delete_event\`：删除日历事件

## 指引

- 课表按学期组织；缺周次或学期日期时不要猜测日期，先问用户
- 作业 DDL、考试安排值得跟踪时，用 create_event 写入日历（可从 TODO 与 Canvas 作业获取时间）
- 日历事件里 todo: 前缀的是待办派生色块，不可经 delete_event 删除
- 通用：\`dela help\` 查看全部命令与参数；不确定就先 help，不要猜测
`,
};

let builtinEnsured = false;
/** 首次使用时把内置 Skill 写入 ~/.dela/skills；已存在不覆盖（用户可自行编辑，删掉后重启恢复）。 */
export function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
  for (const [name, markdown] of Object.entries(BUILTIN_SKILLS)) {
    const path = join(builtinSkillsDirectory(), name, SKILL_ENTRY_FILE);
    if (existsSync(path)) {
      if (name === DOCUMENT_SKILL) {
        const previous = markdown
          .replace('、邮件附件和 web_fetch 返回的 PDF 临时任务', '和邮件附件')
          .replace(/^网页 PDF：.*\r?\n\r?\n/m, '');
        if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === previous.replace(/\r\n/g, '\n'))
          writeFileSync(path, markdown, 'utf8');
      }
      if (name === 'canvas' || name === 'mail') {
        const current = readFileSync(path, 'utf8');
        const migrated = current
          .replace(
            '读资料正文（PDF/DOCX 提取文字，扫描件可传 pages 渲染页面图像）',
            '读资料页面正文；文件正文使用 document-reading Skill',
          )
          .replace('，PDF/DOCX 提取文字', '；用 document-reading Skill 读取文件正文');
        if (migrated !== current) writeFileSync(path, migrated, 'utf8');
      }
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, markdown, 'utf8');
  }
  const script = join(builtinSkillsDirectory(), DOCUMENT_SKILL, 'scripts', 'read.py');
  mkdirSync(dirname(script), { recursive: true });
  if (!existsSync(script) || readFileSync(script, 'utf8') !== documentScript)
    writeFileSync(script, documentScript, 'utf8');
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
