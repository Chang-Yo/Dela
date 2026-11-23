// 远端工具写文件与 helper 的目录监视都经这条进程内广播通知渲染端重读目录。
// main 入口把广播转成窗口事件。
type Listener = (path: string) => void;

const listeners = new Set<Listener>();

export function onRemoteChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyRemoteChange(path: string): void {
  for (const listener of listeners) listener(path);
}
