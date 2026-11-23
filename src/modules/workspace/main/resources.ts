import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { workspaceEntryIdSchema } from '../contract';
import {
  resourceAddressSchema,
  resourceResolver,
  withResourceFile,
} from '../../../core/capabilities/resources';
import { entry, importWorkspaceFiles, workspaceFilePath } from './api';
import { localFileFormat, textRevision } from './files';
import { workspaceSource } from './sources';
import {
  TEXT_PREVIEW_MAX_BYTES,
  formatByName,
  imageMimeOf,
  isTextContent,
} from '../../../core/protocol/files';
import { hostPorts } from '../../../core/ports';

export interface ResourceContent {
  title: string;
  format: 'file' | 'text' | 'markdown' | 'html' | 'image';
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
  revision?: string;
  url?: string;
}

/** Agent 的资源读取不生成预览地址、不查询 Office 导出，也不枚举解析格式。 */
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

/** 邮件附件落在临时目录，启动竞态下会被清理，所以只放行有持久文件的资源。 */
export async function openResourceFile(input: unknown): Promise<void> {
  const parsed = resourceAddressSchema.parse(input);
  const { path } = resourceResolver(parsed.type);
  if (!path) throw new Error('仅支持资料文件与我的资料条目');
  await hostPorts()
    .desktop.open(await path(parsed))
    .catch((error: Error) => {
      throw new Error(`无法用系统默认程序打开：${error.message}`);
    });
}
