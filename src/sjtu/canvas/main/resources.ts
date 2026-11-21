import { readFile } from 'node:fs/promises';
import { hostPorts } from '../../../core/ports';
import {
  previewFileResponse,
  type ResourceContent,
  type WorkspaceSource,
} from '../../../modules/workspace';
import {
  cachedFile,
  canvasFilePath,
  canvasPreviewPath,
  getSource,
  readCanvasPage,
  readCanvasSource,
} from './api';

// Canvas 只按 mime 认得出图片；与工作区图片同一套视觉模型可读的位图。
const canvasImageMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

async function readCanvasResource(id: string): Promise<ResourceContent> {
  const source = getSource(id);
  if (source.kind !== 'file') {
    const page = await readCanvasPage(id);
    return { ...page, format: page.format === 'html' ? 'html' : 'file' };
  }
  if (!canvasImageMimes.includes(source.mime ?? '')) return { title: source.title, format: 'file' };
  const cached = await cachedFile(source);
  return {
    title: source.title,
    format: 'image',
    bytes: await readFile(cached.path),
    mime: cached.mime,
  };
}

export const canvasWorkspaceSource: WorkspaceSource = {
  owns: (sourceId) => /^(?:file|assignment|discussion|page|module-item):/.test(sourceId),
  validate(sourceId) {
    if (!hostPorts().database().prepare('SELECT 1 FROM canvas_sources WHERE id=?').get(sourceId))
      throw new Error('资料不存在，请先同步课程');
  },
  filePath: canvasFilePath,
  preview: readCanvasSource,
  read: readCanvasResource,
};

/** dela-resource://canvas/<资料 id>：Canvas 文件的缓存副本，只放行 PDF 与可识别的 OOXML。 */
export async function handleCanvasPreviewRequest(request: Request, url: URL): Promise<Response> {
  const path = await canvasPreviewPath(decodeURIComponent(url.pathname.slice(1)));
  return previewFileResponse(path, request);
}
