// 项目快捷方式注册口：条目只存 sourceId，读取与校验交给认领它的模块；工作区不认识具体平台。
import type { ResourceContent } from './resources';
import type { DocumentContent } from '../../../core/protocol/workbench';

export interface WorkspaceSource {
  /** sourceId 以它开头的都归本模块；与界面侧登记的前缀相同。 */
  prefix: string;
  validate(sourceId: string): void;
  added?(sourceId: string): void;
  collect?(): Promise<void>;
  filePath?(sourceId: string): Promise<string>;
  preview(sourceId: string): Promise<DocumentContent>;
  read(sourceId: string): Promise<ResourceContent>;
}

const sources: WorkspaceSource[] = [];

export function registerWorkspaceSource(source: WorkspaceSource): void {
  const overlapping = sources.find(
    (item) => item.prefix.startsWith(source.prefix) || source.prefix.startsWith(item.prefix),
  );
  if (overlapping)
    throw new Error(
      `资料前缀 ${source.prefix} 与 ${overlapping.prefix} 重叠，sourceId 无法确定归属`,
    );
  sources.push(source);
}

export function workspaceSource(sourceId: string): WorkspaceSource {
  const source = sources.find((item) => sourceId.startsWith(item.prefix));
  if (!source) throw new Error('该资料暂不可用：对应的功能未启用');
  return source;
}

export async function collectWorkspaceSources(): Promise<void> {
  for (const source of sources) await source.collect?.();
}
