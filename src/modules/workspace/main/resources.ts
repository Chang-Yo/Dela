import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { workspaceEntryIdSchema } from '../contract';
import { resourceAddressSchema, withResourceFile } from '../../../core/capabilities/resources';
import { entry, importWorkspaceFiles, workspaceFilePath } from './api';
import { localFileFormat, textRevision } from './files';
import { workspaceSource } from './sources';
import {
  TEXT_PREVIEW_MAX_BYTES,
  formatByName,
  imageMimeOf,
  isTextContent,
} from '../../../core/protocol/files';

export interface ResourceContent {
  title: string;
  format: 'file' | 'text' | 'markdown' | 'html' | 'image';
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
  revision?: string;
  url?: string;
}

/** Agent 的资源读取不生成预览地址，也不枚举解析格式。 */
export async function readWorkspaceResource(id: string): Promise<ResourceContent> {
  const item = entry(id);
  if (item.kind === 'source' && item.sourceId)
    return workspaceSource(item.sourceId).read(item.sourceId);
  if (item.kind !== 'file') throw new Error('请选择要读取的文件');
  const named = formatByName(item.path ?? item.name);
  if (named && named !== 'markdown' && named !== 'image')
    return { title: item.name, format: 'file' };
  const path = await workspaceFilePath(id);
  const format = localFileFormat(path);
  if (format !== 'text' && format !== 'markdown' && format !== 'image')
    return { title: item.name, format: 'file' };
  const stats = await stat(path);
  // Agent 按 offset 分页读文本，不受编辑上限约束；只挡住整篇进内存会出问题的体量。
  if (stats.size > TEXT_PREVIEW_MAX_BYTES) throw new Error('文件较大，请在外部应用中打开');
  const bytes = await readFile(path);
  if (format === 'image')
    return {
      title: item.name,
      format: 'image',
      bytes,
      mime: imageMimeOf(path),
      revision: `${stats.mtimeMs}-${stats.size}`,
    };
  if (!isTextContent(bytes)) return { title: item.name, format: 'file' };
  const content = bytes.toString('utf8');
  return { title: item.name, format, text: content, revision: textRevision(content) };
}

export async function copyResourceToProject(input: unknown) {
  const { source, parentId } = z
    .object({ source: resourceAddressSchema, parentId: workspaceEntryIdSchema })
    .strict()
    .parse(input);
  return withResourceFile(source, (path) => {
    const [entry] = importWorkspaceFiles(parentId, [path]);
    return { ref: { type: 'workspace' as const, id: entry!.id }, entry: entry! };
  });
}
