// Skills 发现与启停（agent-workspace-plan.md §5.3）：~/.dela/skills/<name>/SKILL.md 与
// 旧工作目录 skills/（兼容已有用户数据）（agentskills.io 规范：YAML frontmatter
// name+description，正文 Markdown，同目录支持文件）。
// 渐进加载：这里只产出名称与描述的索引，正文经 read_skill / read_skill_file 按需读取。
// 启停状态持久化于 workspace_settings('skills-disabled')：只存禁用清单，默认全启用。
import { app } from 'electron';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { SkillView } from '../../../shared/capabilities';
import { getDatabase } from '../../database';
import { storageDirectory } from '../../storage';
import type { SkillIndexEntry } from './types';

export const SKILL_ENTRY_FILE = 'SKILL.md';

/** 内置 Skill 根目录：~/.dela/skills（campus 随应用写入；用户自己的 Skill 也放这里）。 */
export function builtinSkillsDirectory(): string {
  return join(app.getPath('home'), '.dela', 'skills');
}

/** 旧版用户 Skill 目录（工作目录 skills/）：继续扫描，与内置目录合并展示。 */
export function skillsDirectory(): string {
  return join(storageDirectory(), 'skills');
}

/** 内置 Skill 正文：校园与工作区业务经 shell 的 dela 命令接入（commands.ts 的命令桥）。 */
const BUILTIN_SKILLS: Readonly<Record<string, string>> = {
  campus: `---
name: campus
description: 交大校园与工作区业务命令（Canvas 课程资料、邮件、水源社区、课表日程、待办作业、项目管理），经 shell 工具的 dela 命令调用
---

# 校园业务命令（dela）

shell 工具内可用 \`dela\` 访问应用的校园与工作区业务：Canvas 课程与资料、邮箱、水源社区、课表与日程、待办与作业、项目/文件夹/文件管理。命令复用应用已保存的登录会话与本地缓存，不需要也无法在命令里传密码或令牌。

## 用法

- \`dela help\` 列出全部命令、说明与参数 JSON Schema
- \`dela help '<命令名>'\` 只看单个命令的参数
- \`dela <命令名> '<JSON 参数>'\` 执行命令；JSON 用单引号包裹，缺省为 \`{}\`

示例：\`dela query_todos '{}'\`；\`dela search_mail '{"query":"成绩单","limit":20}'\`。

返回 JSON。失败时 shell 抛出错误消息（通常是业务原因：未配置邮箱、登录过期、资料不存在等），按消息处理或询问用户，不要盲目重试。

## 约定

- 只读命令普遍带 freshness / coverage 元信息；列表命令支持分页或 offset+limit
- 返回的资源引用（ref，形如 \`{"type":"mail","id":123}\`）直接传给 read_resource 工具读取正文
- 项目、文件夹与普通文件用磁盘路径标识；创建/移动命令返回新路径
- 不确定命令名或参数时先 \`dela help\`，不要猜测
`,
};

let builtinEnsured = false;
/** 进程内首次发现时把内置 Skill 写入 ~/.dela/skills（已存在不覆盖：用户可自行编辑；
 * 删除内置 Skill 后重启应用恢复内置版本）。 */
function ensureBuiltinSkills(): void {
  if (builtinEnsured) return;
  builtinEnsured = true;
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

/** 发现全部 Skill（含禁用）：~/.dela/skills 与旧工作目录 skills/ 下的 SKILL.md；
 * 重名以内置目录为准；畸形或不可读仍列出，描述置空。 */
export function listSkills(): SkillView[] {
  ensureBuiltinSkills();
  const disabled = readDisabledSkills();
  const skills: SkillView[] = [];
  const seen = new Set<string>();
  for (const directory of [builtinSkillsDirectory(), skillsDirectory()]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      if (!skillNameSchema.safeParse(entry.name).success) continue;
      const path = join(directory, entry.name, SKILL_ENTRY_FILE);
      if (!existsSync(path)) continue;
      seen.add(entry.name);
      let description = '';
      try {
        description = parseSkillMarkdown(readFileHead(path)).frontmatter.description;
      } catch {
        // SKILL.md 不可读：保留条目供 UI 呈现来源，索引描述为空。
      }
      skills.push({ name: entry.name, description, enabled: !disabled.has(entry.name), path });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
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
