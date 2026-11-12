// 远端没有文件监听、目录树清单展开即缓存，远端工具改过文件后靠这条进程内广播通知渲染端重读，
// 否则 AI 新建的文件要收起再展开才看得到。main 入口把广播转成窗口事件。
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
