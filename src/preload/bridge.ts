import { ipcRenderer } from 'electron';
import { channelsOf, type Bridge } from '../core/protocol/contract';
import { contracts } from '../app/contracts';

const channels = new Set(contracts.flatMap(channelsOf));

export const bridge: Bridge = {
  invoke(channel, input) {
    if (!channels.has(channel)) return Promise.reject(new Error(`未登记的通道：${channel}`));
    return ipcRenderer.invoke(channel, input);
  },
};
