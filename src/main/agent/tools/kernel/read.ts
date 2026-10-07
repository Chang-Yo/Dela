import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import { tool } from '../shared';
import { resolveToolPath } from './path';

const filePath = z.string().trim().min(1);
const revision = (text: string) => createHash('sha256').update(text).digest('hex');

export { filePath, revision };

export const readTool = tool(
  '读取文件内容或列出目录。文本按行分页：offset 是从 1 开始的行号，limit 是行数，长行用 characterOffset 续读。图片返回 base64，PDF 可传 pages 读取页面图片，DOCX/PPTX 自动提取文本。路径可以是绝对路径或相对当前工作目录。',
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
      if (bytes.includes(0)) throw new Error('文件为二进制，请用 Bash 或外部应用处理');
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
