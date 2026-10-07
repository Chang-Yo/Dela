// ReadSkills 工具的实现（渐进加载的读取侧）：正文与目录内支持文件按需读取。
// 依赖方向：tools/kernel/skills.ts 经 tool() 包装调用本文件；本文件不 import tools/registry。
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { toolError } from '../tools/shared';
import { enabledSkill, parseSkillMarkdown } from './skills';

// 白名单文本类扩展：Skill 支持文件按需读取的范围；二进制与可执行内容不在能力层读取范围。
const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'csv',
  'yaml',
  'yml',
  'toml',
  'ini',
  'xml',
  'html',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'sh',
  'ps1',
  'sql',
]);

/** 单文件读取上限：超出部分截断并在结果中标注（防止支持文件撑爆上下文）。 */
export const SKILL_FILE_LIMIT_BYTES = 200 * 1024;

/** 读取至多 limit 字节的文本（调用方已确认文件存在）；超限只读 limit 字节，不整读进内存。 */
function readCappedText(
  path: string,
  size: number,
  limit: number,
): { text: string; truncated: boolean } {
  const truncated = size > limit;
  if (!truncated) return { text: readFileSync(path, 'utf8'), truncated };
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    // subarray 截到实读字节数：fill 会把已读入的数据清零，不能用它裁剪长度。
    const read = readSync(descriptor, buffer, 0, limit, 0);
    return { text: buffer.subarray(0, read).toString('utf8'), truncated };
  } finally {
    closeSync(descriptor);
  }
}

/** 读取 SKILL.md 正文（frontmatter 之后的部分）；与支持文件同享单文件上限，超限截断并在末尾标注。 */
export function readSkillBody(name: string): string {
  const skill = enabledSkill(name);
  if (!skill) throw toolError('NOT_FOUND', `Skill 不存在或已停用：${name}`);
  const { text, truncated } = readCappedText(
    skill.path,
    statSync(skill.path).size,
    SKILL_FILE_LIMIT_BYTES,
  );
  const body = parseSkillMarkdown(text).body;
  return truncated
    ? `${body}\n\n[Skill 说明超过 ${SKILL_FILE_LIMIT_BYTES} 字节，已截断；如需完整内容请让用户查看源文件]`
    : body;
}

/**
 * 读取 Skill 目录内的相对文本文件。路径守卫：禁止绝对路径与 .. 段（解析后必须仍在
 * Skill 目录内），扩展名限白名单文本类；超过上限截断并在结果中标注。
 */
export function readSkillFile(name: string, relativePath: string) {
  const skill = enabledSkill(name);
  if (!skill) throw toolError('NOT_FOUND', `Skill 不存在或已停用：${name}`);
  if (isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath))
    throw toolError('INVALID_INPUT', '只允许 Skill 目录内的相对路径');
  const segments = relativePath.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..' || segment === '' || segment === '.'))
    throw toolError('INVALID_INPUT', '路径不能包含 .. 或空路径段');
  const extension = extname(relativePath).slice(1).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension))
    throw toolError(
      'INVALID_INPUT',
      `不支持的文件类型 .${extension || '（无扩展名）'}，仅允许文本类文件`,
    );
  const directory = resolve(skill.path, '..');
  const path = resolve(directory, join(...segments));
  if (path !== directory && !path.startsWith(directory + sep))
    throw toolError('INVALID_INPUT', '路径不能越出 Skill 目录');
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw toolError('NOT_FOUND', `文件不存在：${relativePath}`);
  }
  // 字面包含判断可被目录联接/符号链接绕过：双方 realpath（此时均已存在）后复判包含。
  const realRoot = realpathSync(directory);
  const realPath = realpathSync(path);
  if (realPath !== realRoot && !realPath.startsWith(realRoot + sep))
    throw toolError('INVALID_INPUT', '路径不能越出 Skill 目录');
  const { text, truncated } = readCappedText(path, size, SKILL_FILE_LIMIT_BYTES);
  return {
    name,
    path: relativePath,
    text,
    truncated,
    ...(truncated
      ? {
          sizeBytes: size,
          note: `文件超过 ${SKILL_FILE_LIMIT_BYTES} 字节，已截断；如需完整内容请让用户查看源文件`,
        }
      : {}),
  };
}
