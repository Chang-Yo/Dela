import { contextBridge, ipcRenderer } from 'electron';
import type { DelaApi, MailConfigureInput, MailSyncStatus, WindowState } from '../shared/api';

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
  mail: {
    getState: () => ipcRenderer.invoke('mail:get-state'),
    configure: (input: MailConfigureInput) => ipcRenderer.invoke('mail:configure', input),
    disconnect: () => ipcRenderer.invoke('mail:disconnect'),
    listFolders: () => ipcRenderer.invoke('mail:list-folders'),
    listMessages: (folderId: number, limit: number) =>
      ipcRenderer.invoke('mail:list-messages', folderId, limit),
    getMessage: (messageId: number) => ipcRenderer.invoke('mail:get-message', messageId),
    markSeen: (messageId: number) => ipcRenderer.invoke('mail:mark-seen', messageId),
    syncNow: () => ipcRenderer.invoke('mail:sync'),
    onSyncStatus: (listener: (status: MailSyncStatus) => void) => {
      const subscription = (_event: unknown, status: MailSyncStatus) => listener(status);
      ipcRenderer.on('mail:sync-status', subscription);
      return () => {
        ipcRenderer.removeListener('mail:sync-status', subscription);
      };
    },
  },
} satisfies DelaApi);
