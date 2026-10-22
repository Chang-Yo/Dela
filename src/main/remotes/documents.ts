/**
 * 远端文件只读预览：格式判定与本地共用 shared/files。字节来自远端且不能整篇进内存，
 * 文本/图片只读限长片段，PDF/docx/xlsx 交给 dela-resource 按 Range 拉取；PPTX 导出依赖本地路径，按不支持处理。
 */
import type { DocumentContent } from '../../shared/documents';
import {
  TEXT_EDIT_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  formatByName,
  imageMimeOf,
  isTextContent,
} from '../../shared/files';
import { readRemoteRange, statRemoteFile } from './operations';
import type { RemoteTarget } from './transport';

/** 图片直传上限：再大就按不支持处理，避免整张图进主进程内存。 */
const IMAGE_LIMIT = 32 * 1024 * 1024;

function remoteDocumentTitle(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** 远端文档的流式地址：projectId 定位连接与根目录，path 是远端绝对路径。 */
function remotePreviewUrl(projectId: string, path: string, revision: string): string {
  const query = `path=${encodeURIComponent(path)}&v=${encodeURIComponent(revision)}`;
  return `dela-resource://remote/${encodeURIComponent(projectId)}?${query}`;
}

/** 预览协议的 content-type：远端没有可信 mime，按扩展名给。 */
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
