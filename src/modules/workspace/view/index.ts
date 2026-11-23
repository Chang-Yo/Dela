// 标签与工作台不在这里，仍在外壳（renderer/workbench）。
export { Explorer, type ExplorerItem, type ExplorerPending } from './explorer';
export { onWorkspaceEvent, workspaceClient } from './client';
export { useWorkspaceStore } from './store';

export function localPathsOf(files: File[]): string[] {
  return files.map((file) => window.dela?.pathForFile(file) ?? '').filter(Boolean);
}
