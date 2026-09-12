import { contextBridge, ipcRenderer } from 'electron';
import { version } from '../../package.json';
import type {
  DelaApi,
  CalendarEventInput,
  MailComposeFileKind,
  MailConfigureInput,
  MailSendInput,
  MailSyncStatus,
  WindowState,
} from '../shared/api';

contextBridge.exposeInMainWorld('dela', {
  version,
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
    downloadAttachment: (messageId: number, part: string) =>
      ipcRenderer.invoke('mail:download-attachment', messageId, part),
    pickComposeFiles: (kind: MailComposeFileKind) =>
      ipcRenderer.invoke('mail:pick-compose-files', kind),
    addComposeImage: (dataUrl: string) => ipcRenderer.invoke('mail:add-compose-image', dataUrl),
    releaseComposeFiles: (ids: readonly string[]) =>
      ipcRenderer.invoke('mail:release-compose-files', ids),
    sendMessage: (input: MailSendInput) => ipcRenderer.invoke('mail:send-message', input),
    syncNow: () => ipcRenderer.invoke('mail:sync'),
    onSyncStatus: (listener: (status: MailSyncStatus) => void) => {
      const subscription = (_event: unknown, status: MailSyncStatus) => listener(status);
      ipcRenderer.on('mail:sync-status', subscription);
      return () => {
        ipcRenderer.removeListener('mail:sync-status', subscription);
      };
    },
  },
  timetable: {
    getState: (semester?: string) => ipcRenderer.invoke('timetable:get-state', semester),
    connect: () => ipcRenderer.invoke('timetable:connect'),
    disconnect: () => ipcRenderer.invoke('timetable:disconnect'),
    listLessons: (semester?: string) => ipcRenderer.invoke('timetable:list-lessons', semester),
    listEvents: (startAt: string, endAt: string) =>
      ipcRenderer.invoke('timetable:list-events', startAt, endAt),
    createEvent: (input: CalendarEventInput) => ipcRenderer.invoke('timetable:create-event', input),
    syncNow: (semester?: string) => ipcRenderer.invoke('timetable:sync', semester),
  },
} satisfies DelaApi);
