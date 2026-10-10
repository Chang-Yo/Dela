/**
 * 远端文件变化通知：远端工具动过文件系统后，告诉渲染端「这个目录可能要重读」。
 *
 * 远端没有文件监听，目录树的清单又是展开一次就缓存住——没有这条通知，AI 新建的文件
 * 只能靠用户收起再展开（或重开项目）才看得到。这里只做进程内广播，由 main 入口转成窗口事件。
 */
type Listener = (path: string) => void;

const listeners = new Set<Listener>();

export function onRemoteChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** path：可能已变化的远端目录；子目录也可能变了，由订阅方按前缀处理。 */
export function notifyRemoteChange(path: string): void {
  for (const listener of listeners) listener(path);
}
