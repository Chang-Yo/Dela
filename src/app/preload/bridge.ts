import { ipcRenderer } from 'electron';
import type { Bridge, ChannelManifest } from '../../core/protocol/contract';

// 名单由主进程按实际注册的契约下发，在页面脚本运行前取好，页面改不了。
const manifest: ChannelManifest = ipcRenderer.sendSync('contract:manifest');
const channels = new Set(manifest.channels);
const eventChannels = new Set(manifest.events);

export const bridge: Bridge = {
  queryEvents: manifest.events.filter((channel) => channels.has(channel)),
  invoke(channel, input) {
    if (!channels.has(channel)) return Promise.reject(new Error('该功能在当前版本中未启用'));
    return ipcRenderer.invoke(channel, input);
  },
  subscribe(channel, listener) {
    if (!eventChannels.has(channel)) throw new Error(`未登记的事件：${channel}`);
    // 主进程只向登记过的窗口推送；重复登记无副作用，且先于随后的读取送达。
    void ipcRenderer.invoke('contract:subscribe');
    const handler = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};
