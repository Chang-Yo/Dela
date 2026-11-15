// 工作区的渲染端出口：目录树组件、条目镜像与客户端；标签与工作台仍在外壳（renderer/workbench）。
export { Explorer, type ExplorerItem, type ExplorerPending } from './explorer';
export { onWorkspaceEvent, workspaceClient } from './client';
export { useWorkspaceStore } from './store';

/** 拖进来的文件换成本机路径；没有本地路径的（如从网页拖入）丢掉。 */
export function localPathsOf(files: File[]): string[] {
  return files.map((file) => window.dela?.pathForFile(file) ?? '').filter(Boolean);
}
