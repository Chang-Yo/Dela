/**
 * 远端文件只读预览：格式判定与本地共用 shared/documents。字节来自远端且不能整篇进内存，
 * 文本/图片只读限长片段，PDF/docx/xlsx 交给 dela-resource 按 Range 拉取；PPTX 导出依赖本地路径，按不支持处理。
 */
import type { DocumentContent } from '../../shared/documents';
import { documentFormatOf } from '../../shared/documents';
import { readRemoteRange, statRemoteFile } from './operations';
import type { RemoteTarget } from './transport';

/** 文本预览的读取上限：够看代码与 Markdown，超出只给头部并说明。 */
const TEXT_LIMIT = 4 * 1024 * 1024;
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
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (documentFormatOf(path) === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (documentFormatOf(path) === 'xlsx')
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
  const format = documentFormatOf(path);
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
  if (format === 'text' || format === 'markdown') {
    const bytes = await readRemoteRange(target, path, 0, Math.min(size, TEXT_LIMIT));
    const text = bytes.toString('utf8');
    return {
      title,
      format,
      text:
        size > TEXT_LIMIT
          ? `${text}\n\n---\n\n（远端文件共 ${size} 字节，这里只读了前 ${TEXT_LIMIT / 1024 / 1024} MB。要看完整内容请下载文件或用系统默认程序打开。）`
          : text,
      revision,
    };
  }
  return { title, format: 'unsupported', revision };
}
