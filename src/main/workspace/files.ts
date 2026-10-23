// 本地文件的读与写：工作区、Agent 资源读取都从这里拿字节与格式，分类规则在 shared/files。
// 写入的唯一承诺是「用户改了什么就只改什么」：不改换行符、不改 BOM、不换掉文件本身
// （原地覆写保住可执行位、硬链接与符号链接指向；先写临时文件再 rename 会把它们全丢掉）。
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SNIFF_BYTES,
  TEXT_EDIT_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  fileFormatOf,
  formatByName,
  isTextContent,
  type FileFormat,
} from '../../shared/files';

export const textRevision = (text: string) => createHash('sha256').update(text).digest('hex');

function readHead(path: string, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  const fd = openSync(path, 'r');
  try {
    const read = readSync(fd, buffer, 0, size, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** 本地文件格式：专用格式只看名字，其余读开头嗅探。目录与读不了的文件交给调用方处理。 */
export function localFileFormat(path: string): FileFormat {
  const named = formatByName(path);
  if (named) return named;
  const size = statSync(path).size;
  return fileFormatOf(path, readHead(path, Math.min(size, SNIFF_BYTES)), size > SNIFF_BYTES);
}

export type LocalText =
  | {
      kind: 'text';
      format: 'markdown' | 'text';
      text: string;
      readOnly: boolean;
      truncated: boolean;
    }
  | { kind: 'binary' };

/** 读文本文件：编辑上限内整篇可编辑；超出只读头部；超过预览上限不读内容。
 *  Markdown 也要过同一遍嗅探——扩展名对，内容不一定是 UTF-8。 */
export function readLocalText(path: string, format: 'markdown' | 'text'): LocalText {
  const size = statSync(path).size;
  if (size > TEXT_PREVIEW_MAX_BYTES) return { kind: 'binary' };
  const truncated = size > TEXT_EDIT_MAX_BYTES;
  const bytes = truncated ? readHead(path, TEXT_EDIT_MAX_BYTES) : readFileSync(path);
  if (!isTextContent(bytes, truncated)) return { kind: 'binary' };
  let text = bytes.toString('utf8');
  // 头部截断可能切在多字节字符中间：丢掉末尾的替换字符，只读预览不需要那半个字。
  if (truncated) text = text.replace(/\uFFFD+$/, '');
  return { kind: 'text', format, text, readOnly: truncated, truncated };
}

/** 原地覆写文本：revision 是打开时整篇内容的哈希，外部改过就拒绝，草稿留在界面上。 */
export function writeLocalText(path: string, text: string, revision: string): string {
  if (statSync(path).size > TEXT_EDIT_MAX_BYTES) throw new Error('文件超过 1 MB，只能只读查看');
  const disk = readFileSync(path, 'utf8');
  if (textRevision(disk) !== revision)
    throw new Error('文件已在外部修改。你的草稿仍在，请另存或重新载入后编辑。');
  writeFileSync(path, text);
  return textRevision(text);
}
