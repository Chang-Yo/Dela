// 远端文件只读预览：字节不能整篇进内存，文本/图片只读限长片段，PDF/Office 经 dela-resource 按 Range 拉取。
// PPTX 导出依赖本地路径，按不支持处理。
import {
  TEXT_EDIT_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  formatByName,
  imageMimeOf,
  isTextContent,
} from '../../../core/protocol/files';
import { readRemoteRange, statRemoteFile } from '../../../core/remote/operations';
import type { RemoteTarget } from '../../../core/remote/transport';
import type { DocumentContent } from '../../../core/protocol/workbench';

const IMAGE_LIMIT = 32 * 1024 * 1024;

function remoteDocumentTitle(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function remotePreviewUrl(projectId: string, path: string, revision: string): string {
  const query = `path=${encodeURIComponent(path)}&v=${encodeURIComponent(revision)}`;
  return `dela-resource://remote/${encodeURIComponent(projectId)}?${query}`;
}

export function remoteDocumentMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  const image = imageMimeOf(path);
  if (image) return image;
  if (formatByName(path) === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (formatByName(path) === 'xlsx')
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

export async function readRemoteDocument(
  projectId: string,
  target: RemoteTarget,
  path: string,
): Promise<DocumentContent> {
  const title = remoteDocumentTitle(path);
  const entry = await statRemoteFile(target, path);
  const size = entry.size ?? 0;
  const revision = `${entry.modifiedAt ?? 0}-${size}`;
  const format = formatByName(path);
  if (format === 'pdf' || format === 'docx' || format === 'xlsx')
    return {
      title,
      format,
      previewUrl: remotePreviewUrl(projectId, path, revision),
      mime: remoteDocumentMime(path),
      revision,
    };
  if (format === 'image') {
    if (size > IMAGE_LIMIT)
      throw new Error(
        `图片 ${Math.round(size / 1024 / 1024)} MB，超过应用内预览上限（${IMAGE_LIMIT / 1024 / 1024} MB）`,
      );
    const bytes = await readRemoteRange(target, path, 0, size);
    return {
      title,
      format,
      bytes: new Uint8Array(bytes),
      mime: remoteDocumentMime(path),
      revision,
    };
  }
  if (format === 'pptx' || size > TEXT_PREVIEW_MAX_BYTES)
    return { title, format: 'binary', revision };
  // 远端只读：文本同样只拉编辑上限那么多字节，再大的文件给头部并标注截断。
  const truncated = size > TEXT_EDIT_MAX_BYTES;
  const bytes = await readRemoteRange(target, path, 0, Math.min(size, TEXT_EDIT_MAX_BYTES));
  if (!isTextContent(bytes, truncated)) return { title, format: 'binary', revision };
  return {
    title,
    format: format === 'markdown' ? 'markdown' : 'text',
    text: truncated ? bytes.toString('utf8').replace(/\uFFFD+$/, '') : bytes.toString('utf8'),
    readOnly: true,
    truncated: truncated || undefined,
    revision,
  };
}
