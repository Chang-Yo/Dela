import { ipcRenderer } from 'electron';
import { channelsOf, eventChannelsOf, type Bridge } from '../core/protocol/contract';
import { contracts } from '../app/contracts';

const channels = new Set(contracts.flatMap(channelsOf));
const eventChannels = new Set(contracts.flatMap(eventChannelsOf));

export const bridge: Bridge = {
  invoke(channel, input) {
    if (!channels.has(channel)) return Promise.reject(new Error(`未登记的通道：${channel}`));
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
