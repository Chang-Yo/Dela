import { fileTypeFromFile } from 'file-type';

export type OfficeZipKind = 'docx' | 'pptx' | 'xlsx';
export const officeZipMime: Record<OfficeZipKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** GUI 预览按实际文件内容识别；正文提取交给 document-reading skill。 */
export async function classifyOfficeFile(path: string): Promise<OfficeZipKind | null> {
  const kind = await fileTypeFromFile(path).catch(() => undefined);
  return kind?.ext === 'docx' || kind?.ext === 'pptx' || kind?.ext === 'xlsx' ? kind.ext : null;
}
