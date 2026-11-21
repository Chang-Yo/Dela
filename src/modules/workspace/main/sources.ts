// 项目快捷方式注册口：条目只存 sourceId，读取与校验交给认领它的模块；工作区不认识具体平台。
import type { DocumentContent } from '../contract';
import type { ResourceContent } from './resources';

export interface WorkspaceSource {
  owns(sourceId: string): boolean;
  validate(sourceId: string): void;
  added?(sourceId: string): void;
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
  if (!source) throw new Error('该资料暂不可用：对应的功能未启用');
  return source;
}

export async function collectWorkspaceSources(): Promise<void> {
  for (const source of sources) await source.collect?.();
}
