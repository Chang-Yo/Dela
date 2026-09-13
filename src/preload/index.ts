import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { version } from '../../package.json';
import type {
  DelaApi,
  CalendarEventInput,
  MailComposeFileKind,
  MailConfigureInput,
  MailSendInput,
  MailSyncStatus,
  WindowState,
  WorkspaceCreateInput,
  WorkspaceViewState,
  ThemePreference,
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
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme'),
    setTheme: (theme: ThemePreference) => ipcRenderer.invoke('settings:set-theme', theme),
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
    setSemesterStart: (semester: string, value: string) =>
      ipcRenderer.invoke('timetable:set-semester-start', semester, value),
    syncNow: (semester?: string) => ipcRenderer.invoke('timetable:sync', semester),
  },
  canvas: {
    getState: () => ipcRenderer.invoke('canvas:get-state'),
    configure: (token: string) => ipcRenderer.invoke('canvas:configure', token),
    disconnect: () => ipcRenderer.invoke('canvas:disconnect'),
    syncCourses: () => ipcRenderer.invoke('canvas:sync-courses'),
    syncCourse: (id: number) => ipcRenderer.invoke('canvas:sync-course', id),
    read: (id: string) => ipcRenderer.invoke('canvas:read', id),
    download: (id: string) => ipcRenderer.invoke('canvas:download', id),
    openLink: (url: string) => ipcRenderer.invoke('canvas:open-link', url),
  },
  workspace: {
    getState: () => ipcRenderer.invoke('workspace:get-state'),
    create: (input: WorkspaceCreateInput) => ipcRenderer.invoke('workspace:create', input),
    update: (
      id: string,
      input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
    ) => ipcRenderer.invoke('workspace:update', id, input),
    remove: (id: string) => ipcRenderer.invoke('workspace:remove', id),
    read: (id: string) => ipcRenderer.invoke('workspace:read', id),
    saveNote: (id: string, text: string, revision: string) =>
      ipcRenderer.invoke('workspace:save-note', id, text, revision),
    importFiles: (parentId: string | null) =>
      ipcRenderer.invoke('workspace:import-files', parentId),
    importDroppedFiles: (parentId: string | null, files: File[]) => {
      const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
      return paths.length
        ? ipcRenderer.invoke('workspace:import-dropped-files', parentId, paths)
        : Promise.resolve();
    },
    openLocal: (id: string) => ipcRenderer.invoke('workspace:open-local', id),
    chooseDirectory: () => ipcRenderer.invoke('workspace:choose-directory'),
    saveView: (scope: string, state: WorkspaceViewState) =>
      ipcRenderer.invoke('workspace:save-view', scope, state),
    getChat: (scope: string) => ipcRenderer.invoke('workspace:get-chat', scope),
    configureModel: (key: string, model: string) =>
      ipcRenderer.invoke('workspace:configure-model', key, model),
    ask: (scope: string, prompt: string, context: string[]) =>
      ipcRenderer.invoke('workspace:ask', scope, prompt, context),
  },
} satisfies DelaApi);
