import { ipcRenderer } from 'electron';

export const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

/** IPC 单向消息透传（不需要主进程回应的通道）。 */
export const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

/** 订阅主进程推送的单载荷事件；返回退订函数。 */
export function on<T = void>(channel: string, listener: (payload: T) => void): () => void {
  const subscription = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, subscription);
  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
}
