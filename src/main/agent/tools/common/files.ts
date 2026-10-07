import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { tool, toolError, type ToolContext } from '../shared';

const filePath = z.string().trim().min(1);
export function resolveToolPath(path: string, context: ToolContext): string {
  if (!isAbsolute(path) && !context.cwd)
    throw toolError('INVALID_INPUT', '相对路径需要当前工作目录，请提供绝对路径');
  return resolve(context.cwd ?? '.', path);
}
const revision = (text: string) => createHash('sha256').update(text).digest('hex');

export const readFileTool = tool(
  '按真实路径读取文本、图片、PDF/Office 或列出目录。offset 是从 1 开始的文本行号，limit 是行数；长行可用 characterOffset 继续。PDF 的 pages 可读取页面图片。不需要注册文件。',
  z
    .object({
      path: filePath,
      offset: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(2000).default(200),
      characterOffset: z.number().int().min(0).default(0),
      pages: z.array(z.number().int().positive()).max(4).optional(),
    })
    .strict(),
  async ({ path: input, offset, limit, characterOffset, pages }, context) => {
    const path = resolveToolPath(input, context);
    if (statSync(path).isDirectory())
      return {
        path,
        entries: readdirSync(path, { withFileTypes: true }).map((item) => ({
          name: item.name,
          directory: item.isDirectory(),
        })),
      };
    const extension = extname(path).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
      if (statSync(path).size > 10 * 1024 * 1024)
        throw new Error('图片超过 10MB，请先用外部工具压缩');
      return {
        path,
        images: [
          {
            page: 1,
            dataUrl: `data:image/${extension === '.jpg' ? 'jpeg' : extension.slice(1)};base64,${readFileSync(path).toString('base64')}`,
          },
        ],
      };
    }
    let text: string;
    if (['.pdf', '.docx', '.pptx'].includes(extension)) {
      const { parseDocumentFile, renderPdfPages } = await import('../../../resource-parse');
      if (pages?.length && extension === '.pdf')
        return { path, ...(await renderPdfPages(path, pages)) };
      text = (await parseDocumentFile(path)).text;
    } else {
      const bytes = readFileSync(path);
      if (bytes.includes(0))
        throw toolError('INVALID_INPUT', '文件为二进制，请用 shell 或外部应用处理');
      text = bytes.toString('utf8');
    }
    const lines = text.split('\n');
    const selected = lines.slice(offset - 1, offset - 1 + limit).join('\n');
    const chunk = selected.slice(characterOffset, characterOffset + 16000);
    const hasMoreCharacters = characterOffset + chunk.length < selected.length;
    return {
      path,
      text: chunk,
      revision: revision(text),
      totalLines: lines.length,
      nextOffset: hasMoreCharacters
        ? offset
        : offset - 1 + limit < lines.length
          ? offset + limit
          : null,
      nextCharacterOffset: hasMoreCharacters ? characterOffset + chunk.length : null,
      truncated: hasMoreCharacters,
    };
  },
);

export const writeFileTool = tool(
  '按真实路径创建或完整覆盖 UTF-8 文件，自动创建父目录。覆盖前先 read；可传 revision 防止覆盖随后发生的外部修改。',
  z.object({ path: filePath, text: z.string(), revision: z.string().optional() }).strict(),
  ({ path: input, text, revision: expected }, context) => {
    const resolved = resolveToolPath(input, context);
    const path = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (expected !== undefined && revision(readFileSync(path, 'utf8')) !== expected)
      throw toolError('VERSION_CONFLICT', '文件已修改，请重新读取');
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, {
        encoding: 'utf8',
        mode: existsSync(path) ? statSync(path).mode : undefined,
      });
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return { path, revision: revision(text), bytes: Buffer.byteLength(text) };
  },
);

export const editFileTool = tool(
  '按真实路径局部替换 UTF-8 文件。oldText 必须唯一匹配；可传 revision 防止覆盖外部修改。保留其余内容与换行符。',
  z
    .object({
      path: filePath,
      oldText: z.string().min(1),
      newText: z.string(),
      revision: z.string().optional(),
    })
    .strict(),
  async ({ path: input, oldText, newText, revision: expected }, context) => {
    const path = resolveToolPath(input, context);
    const disk = readFileSync(path, 'utf8');
    if (expected !== undefined && revision(disk) !== expected)
      throw toolError('VERSION_CONFLICT', '文件已修改，请重新读取');
    const start = disk.indexOf(oldText);
    if (start < 0) throw toolError('INVALID_INPUT', '原文不存在，请重新读取');
    if (disk.indexOf(oldText, start + 1) >= 0)
      throw toolError('INVALID_INPUT', '原文出现多次，请扩大匹配范围');
    return writeFileTool.execute(
      {
        path,
        text: disk.slice(0, start) + newText + disk.slice(start + oldText.length),
        revision: revision(disk),
      },
      context,
    );
  },
);
