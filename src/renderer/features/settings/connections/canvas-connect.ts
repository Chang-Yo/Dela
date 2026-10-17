import { useWorkspaceStore } from '../../../workspace/store';

/**
 * 连接 Canvas：主进程开始后台同步，界面先读取现有缓存并订阅后续变化。
 * 失败时抛出错误（调用方用 errorText 转文案）；Canvas 表单与首启向导共用。
 */
export async function connectCanvas(token: string): Promise<void> {
  const dela = window.dela;
  if (!dela) return;
  await dela.canvas.configure(token);
  useWorkspaceStore.getState().setCanvas(await dela.canvas.getState());
}
