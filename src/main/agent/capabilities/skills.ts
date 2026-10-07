// Skills 发现与启停：扫描全局（~/.dela、~/.agents、~/.zcode 的 skills/）与
// 项目（工作区 .agents/.zcode/skills 与旧版 skills/）下的 <name>/SKILL.md
// （agentskills.io 规范：YAML frontmatter name+description，正文 Markdown，
// 同目录支持文件）。渐进加载：这里只产出名称与描述的索引，正文经 ReadSkills 按需读取。
// 启停状态持久化于 workspace_settings('skills-disabled')：只存禁用清单，默认全启用。
import { app } from 'electron';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { SkillScope, SkillView } from '../../../shared/capabilities';
import { getDatabase } from '../../database';
import { storageDirectory } from '../../storage';
import type { SkillIndexEntry } from './types';

export const SKILL_ENTRY_FILE = 'SKILL.md';

/** 全局 Skill 根目录：~/.dela/skills（内置 Skill 随应用写入；用户自己的 Skill 也放这里）。 */
export function builtinSkillsDirectory(): string {
  return join(app.getPath('home'), '.dela', 'skills');
}

/** 旧版用户 Skill 目录（工作目录 skills/）：继续扫描，作为项目范围的一部分。 */
export function skillsDirectory(): string {
  return join(storageDirectory(), 'skills');
}

/** 发现来源（顺序即同名优先级：项目覆盖全局，同范围内先到者优先）。 */
function skillSources(): { scope: SkillScope; directory: string }[] {
  const home = app.getPath('home');
  const workspace = storageDirectory();
  return [
    { scope: 'project', directory: join(workspace, '.agents', 'skills') },
    { scope: 'project', directory: join(workspace, '.zcode', 'skills') },
    { scope: 'project', directory: skillsDirectory() },
    { scope: 'global', directory: builtinSkillsDirectory() },
    { scope: 'global', directory: join(home, '.agents', 'skills') },
    { scope: 'global', directory: join(home, '.zcode', 'skills') },
  ];
}

/** 内置 Skill 正文：领域知识按业务拆分，正文教 agent 经 Bash 的 dela 命令操作（commands.ts）。 */
const BUILTIN_SKILLS: Readonly<Record<string, string>> = {
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
- \`dela read_resource '{"ref":{"type":"canvas","id":"file:123"}}'\`：读资料正文（PDF/DOCX 提取文字，扫描件可传 pages 渲染页面图像）
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
- 附件：ref 用 \`{"type":"attachment","messageId":123,"part":"..."}\`，PDF/DOCX 提取文字
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

/** 已退役的内置 Skill：进程内发现时删除磁盘目录（campus 单体已拆分为领域 Skill）。 */
const RETIRED_BUILTINS = ['campus'];

let builtinEnsured = false;
/** 进程内首次发现时把内置 Skill 写入 ~/.dela/skills（已存在不覆盖：用户可自行编辑；
 * 删除内置 Skill 后重启应用恢复内置版本；退役的内置目录直接移除）。 */
function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
  for (const name of RETIRED_BUILTINS) {
    try {
      const directory = join(builtinSkillsDirectory(), name);
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    } catch {
      // 清理失败不影响发现：listSkills 按磁盘实际内容返回。
    }
  }
  for (const [name, markdown] of Object.entries(BUILTIN_SKILLS)) {
    const path = join(builtinSkillsDirectory(), name, SKILL_ENTRY_FILE);
    try {
      if (existsSync(path)) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, markdown, 'utf8');
    } catch {
      // 写入失败只影响发现：listSkills 仍按磁盘实际内容返回。
    }
  }
}

/** listSkills 只解析 frontmatter：只读文件头部窗口，不把超大 SKILL.md 整读进内存。 */
export const SKILL_HEAD_LIMIT_BYTES = 64 * 1024;

/** 只读文件前 limit 字节；frontmatter 超出窗口（病态）视为无 frontmatter。 */
function readFileHead(path: string): string {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(SKILL_HEAD_LIMIT_BYTES);
    // subarray 截到实读字节数：fill 会把已读入的数据清零，不能用它裁剪长度。
    const read = readSync(descriptor, buffer, 0, SKILL_HEAD_LIMIT_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

/** Skill 目录名限制：作为 read_skill 标识与目录名，拒绝空白与路径分隔符。 */
const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_-]+$/u, 'Skill 名称只能包含文字、数字、下划线或短横线');

const disabledListSchema = z.array(z.string());

/**
 * 轻量 frontmatter 解析：首个 --- 块内的 name:/description: 行（单行值，容忍 CRLF 与
 * 块缺失/字段缺失）。不引入 YAML 依赖；正文为闭合 --- 之后的部分。
 */
export function parseSkillMarkdown(markdown: string): {
  frontmatter: { name: string; description: string };
  body: string;
} {
  const lines = markdown.split(/\r?\n/);
  const meta = { name: '', description: '' };
  if (lines[0]?.trim() !== '---') return { frontmatter: meta, body: markdown };
  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '---') {
      closeIndex = index;
      break;
    }
    const name = /^name:\s*(.*)$/.exec(line);
    if (name) meta.name = name[1]!.trim();
    const description = /^description:\s*(.*)$/.exec(line);
    if (description) meta.description = description[1]!.trim();
  }
  // 无闭合 --- 视为无 frontmatter（畸形容忍：全文都是正文）。
  if (closeIndex < 0) return { frontmatter: { name: '', description: '' }, body: markdown };
  return { frontmatter: meta, body: lines.slice(closeIndex + 1).join('\n') };
}

function readDisabledSkills(): Set<string> {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='skills-disabled'")
    .get() as { value: string } | undefined;
  if (!row) return new Set();
  try {
    const parsed = disabledListSchema.safeParse(JSON.parse(row.value));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

function writeDisabledSkills(names: Iterable<string>): void {
  getDatabase()
    .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('skills-disabled', ?)")
    .run(JSON.stringify([...names]));
}

/** 发现全部 Skill（含禁用）：全局与项目来源目录下的 SKILL.md；同名项目覆盖全局
 * （seen 集合按优先级顺序先占名）；畸形或不可读仍列出，描述置空。 */
export function listSkills(): SkillView[] {
  ensureBuiltinSkills();
  const disabled = readDisabledSkills();
  const skills: SkillView[] = [];
  const seen = new Set<string>();
  for (const source of skillSources()) {
    if (!existsSync(source.directory)) continue;
    for (const entry of readdirSync(source.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      if (!skillNameSchema.safeParse(entry.name).success) continue;
      const path = join(source.directory, entry.name, SKILL_ENTRY_FILE);
      if (!existsSync(path)) continue;
      seen.add(entry.name);
      let description = '';
      try {
        description = parseSkillMarkdown(readFileHead(path)).frontmatter.description;
      } catch {
        // SKILL.md 不可读：保留条目供 UI 呈现来源，索引描述为空。
      }
      skills.push({
        name: entry.name,
        description,
        enabled: !disabled.has(entry.name),
        path,
        scope: source.scope,
      });
    }
  }
  return skills.sort((a, b) =>
    a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'global' ? -1 : 1,
  );
}

/** 启停 Skill；返回最新列表（未知名抛错）。 */
export function setSkillEnabled(name: string, enabled: boolean): SkillView[] {
  const skills = listSkills();
  if (!skills.some((skill) => skill.name === name)) throw new Error(`Skill 不存在：${name}`);
  const disabled = new Set(readDisabledSkills());
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  writeDisabledSkills(disabled);
  return listSkills();
}

/** 已启用 Skill 的紧凑索引（注入模型侧 system；禁用即从索引消失）。 */
export function skillIndex(): SkillIndexEntry[] {
  // 索引是尽力而为的装饰段：目录/配置暂不可读时返回空，不阻断模型上下文组装。
  try {
    return listSkills()
      .filter((skill) => skill.enabled)
      .map(({ name, description }) => ({
        name,
        description: description.replace(/\s+/g, ' ').trim(),
      }));
  } catch {
    return [];
  }
}

/** 按名取已启用 Skill；禁用对模型即不可用（§5.3「后续调用按当前可用性处理」）。 */
export function enabledSkill(name: string): SkillView | undefined {
  return listSkills().find((skill) => skill.name === name && skill.enabled);
}
