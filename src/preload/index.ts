import { contextBridge, ipcRenderer } from 'electron';
import type { DelaApi, WindowState } from '../shared/api';

contextBridge.exposeInMainWorld('dela', {
  version: '0.1.0',
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    getState: () => ipcRenderer.invoke('window:get-state'),
    onStateChange: (listener: (state: WindowState) => void) => {
      const subscription = (_event: unknown, state: WindowState) => listener(state);
      ipcRenderer.on('window:state', subscription);
      return () => {
        ipcRenderer.removeListener('window:state', subscription);
      };
    },
  },
} satisfies DelaApi);
