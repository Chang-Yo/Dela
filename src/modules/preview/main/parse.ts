import { openAsBlob } from 'node:fs';
import { fileTypeFromBlob } from 'file-type';

export type OfficeZipKind = 'docx' | 'pptx' | 'xlsx';
export const officeZipMime: Record<OfficeZipKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** GUI 预览按实际文件内容识别；正文提取交给 read_document 工具。
 *  不用 fileTypeFromFile：它在运行时另行加载 strtok3，打包后找不到，识别总是失败。 */
export async function classifyOfficeFile(path: string): Promise<OfficeZipKind | null> {
  const kind = await openAsBlob(path)
    .then(fileTypeFromBlob)
    .catch(() => undefined);
  return kind?.ext === 'docx' || kind?.ext === 'pptx' || kind?.ext === 'xlsx' ? kind.ext : null;
}
