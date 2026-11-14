import { useWorkspaceStore } from '../../../workspace/store';

/**
 * 连接 Canvas 并同步课程列表：配置 Token、拉取课程并写入全局工作区状态。
 * 失败时抛出错误（调用方用 errorText 转文案）；Canvas 表单与首启向导共用。
 */
export async function connectCanvas(token: string): Promise<void> {
  const dela = window.dela;
  if (!dela) return;
  await dela.canvas.configure(token);
  useWorkspaceStore.getState().setCanvas(await dela.canvas.syncCourses());
}
