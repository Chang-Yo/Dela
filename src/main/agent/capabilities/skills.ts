// Skills 发现与启停（agent-workspace-plan.md §5.3）：工作目录 skills/<name>/SKILL.md
// （agentskills.io 规范：YAML frontmatter name+description，正文 Markdown，同目录支持文件）。
// 渐进加载：这里只产出名称与描述的索引，正文经 read_skill / read_skill_file 按需读取。
// 启停状态持久化于 workspace_settings('skills-disabled')：只存禁用清单，默认全启用。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SkillView } from '../../../shared/capabilities';
import { getDatabase } from '../../database';
import { storageDirectory } from '../../storage';
import type { SkillIndexEntry } from './types';

export const SKILL_ENTRY_FILE = 'SKILL.md';

/** Skill 目录名限制：作为 read_skill 标识与目录名，拒绝空白与路径分隔符。 */
const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_-]+$/u, 'Skill 名称只能包含文字、数字、下划线或短横线');

const disabledListSchema = z.array(z.string());

export function skillsDirectory(): string {
  return join(storageDirectory(), 'skills');
}

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

/** 发现全部 Skill（含禁用）：skills/ 下一级目录内的 SKILL.md；畸形或不可读仍列出，描述置空。 */
export function listSkills(): SkillView[] {
  const directory = skillsDirectory();
  if (!existsSync(directory)) return [];
  const disabled = readDisabledSkills();
  const skills: SkillView[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !skillNameSchema.safeParse(entry.name).success) continue;
    const path = join(directory, entry.name, SKILL_ENTRY_FILE);
    if (!existsSync(path)) continue;
    let description = '';
    try {
      description = parseSkillMarkdown(readFileSync(path, 'utf8')).frontmatter.description;
    } catch {
      // SKILL.md 不可读：保留条目供 UI 呈现来源，索引描述为空。
    }
    skills.push({ name: entry.name, description, enabled: !disabled.has(entry.name), path });
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
