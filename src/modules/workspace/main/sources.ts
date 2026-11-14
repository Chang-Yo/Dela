// 资料来源注册口：source 条目只存 sourceId，读取与校验交给认领它的模块；工作区不认识具体平台。
import type { DocumentContent } from '../../shared/api';
import type { ResourceContent } from '../resources';

export interface WorkspaceSource {
  owns(sourceId: string): boolean;
  /** 新建引用前确认来源存在，不存在时抛出面向用户的错误。 */
  validate(sourceId: string): void;
  added?(sourceId: string): void;
  /** 引用条目被移除后回收不再被引用的本地数据。 */
  collect?(): Promise<void>;
  filePath?(sourceId: string): Promise<string>;
  preview(sourceId: string): Promise<DocumentContent>;
  read(sourceId: string): Promise<ResourceContent>;
}

const sources: WorkspaceSource[] = [];

export function registerWorkspaceSource(source: WorkspaceSource): void {
  sources.push(source);
}

export function workspaceSource(sourceId: string): WorkspaceSource {
  const source = sources.find((item) => item.owns(sourceId));
  if (!source) throw new Error('该资料来源暂不可用：对应的校园服务未启用');
  return source;
}

export async function collectWorkspaceSources(): Promise<void> {
  for (const source of sources) await source.collect?.();
}
