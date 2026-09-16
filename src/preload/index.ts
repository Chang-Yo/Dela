import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { version } from '../../package.json';
import type {
  DelaApi,
  CalendarEventInput,
  LlmSaveInput,
  LlmVerifyInput,
  MailComposeFileKind,
  MailConfigureInput,
  MailSendInput,
  MailDraftInput,
  MailSyncStatus,
  MailTrashRetention,
  ShuiyuanFeed,
  WindowState,
  WorkspaceCreateInput,
  WorkspaceViewState,
  WorkspaceChat,
  ThemePreference,
  IconPreference,
  ZoomPreference,
  FontScalePreference,
  NotificationFilter,
  NotificationState,
} from '../shared/api';

contextBridge.exposeInMainWorld('dela', {
  version,
  search: {
    query: (query: string) => ipcRenderer.invoke('search:query', query),
  },
  notifications: {
    getState: (filter?: NotificationFilter) =>
      ipcRenderer.invoke('notifications:get-state', filter),
    refresh: () => ipcRenderer.invoke('notifications:refresh'),
    markRead: (id: string) => ipcRenderer.invoke('notifications:mark-read', id),
    markAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
    setSnooze: (until: string | null) => ipcRenderer.invoke('notifications:set-snooze', until),
    onUpdate: (listener: (state: NotificationState) => void) => {
      const subscription = (_event: unknown, state: NotificationState) => listener(state);
      ipcRenderer.on('notifications:state', subscription);
      return () => ipcRenderer.removeListener('notifications:state', subscription);
    },
  },
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
    getIcon: () => ipcRenderer.invoke('settings:get-icon'),
    setIcon: (icon: IconPreference) => ipcRenderer.invoke('settings:set-icon', icon),
    getZoom: () => ipcRenderer.invoke('settings:get-zoom'),
    setZoom: (zoom: ZoomPreference) => ipcRenderer.invoke('settings:set-zoom', zoom),
    getFontScale: () => ipcRenderer.invoke('settings:get-font-scale'),
    setFontScale: (scale: FontScalePreference) =>
      ipcRenderer.invoke('settings:set-font-scale', scale),
  },
  llm: {
    list: () => ipcRenderer.invoke('llm:list'),
    save: (input: LlmSaveInput) => ipcRenderer.invoke('llm:save', input),
    remove: (id: string) => ipcRenderer.invoke('llm:remove', id),
    setActive: (id: string) => ipcRenderer.invoke('llm:set-active', id),
    setModel: (model: string) => ipcRenderer.invoke('llm:set-model', model),
    setEffort: (level: string) => ipcRenderer.invoke('llm:set-effort', level),
    verify: (input: LlmVerifyInput) => ipcRenderer.invoke('llm:verify', input),
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
    deleteMessage: (messageId: number) => ipcRenderer.invoke('mail:delete-message', messageId),
    restoreMessage: (messageId: number) => ipcRenderer.invoke('mail:restore-message', messageId),
    purgeMessage: (messageId: number) => ipcRenderer.invoke('mail:purge-message', messageId),
    emptyTrash: () => ipcRenderer.invoke('mail:empty-trash'),
    listTrash: () => ipcRenderer.invoke('mail:list-trash'),
    getTrashRetention: () => ipcRenderer.invoke('mail:get-trash-retention'),
    setTrashRetention: (retention: MailTrashRetention) =>
      ipcRenderer.invoke('mail:set-trash-retention', retention),
    downloadAttachment: (messageId: number, part: string) =>
      ipcRenderer.invoke('mail:download-attachment', messageId, part),
    pickComposeFiles: (kind: MailComposeFileKind) =>
      ipcRenderer.invoke('mail:pick-compose-files', kind),
    addComposeImage: (dataUrl: string) => ipcRenderer.invoke('mail:add-compose-image', dataUrl),
    releaseComposeFiles: (ids: readonly string[]) =>
      ipcRenderer.invoke('mail:release-compose-files', ids),
    sendMessage: (input: MailSendInput) => ipcRenderer.invoke('mail:send-message', input),
    openDraft: (id: string) => ipcRenderer.invoke('workspace:open-email-draft', id),
    saveDraft: (input: MailDraftInput) => ipcRenderer.invoke('mail:save-draft', input),
    listDrafts: (account: string) => ipcRenderer.invoke('mail:list-drafts', account),
    deleteDraft: (id: string) => ipcRenderer.invoke('mail:delete-draft', id),
    confirmDraftClose: () => ipcRenderer.invoke('mail:confirm-draft-close'),
    setComposeActive: (active: boolean) => ipcRenderer.invoke('mail:compose-active', active),
    onRequestClose: (listener: () => void) => {
      const subscription = () => listener();
      ipcRenderer.on('mail:request-close', subscription);
      return () => {
        ipcRenderer.removeListener('mail:request-close', subscription);
      };
    },
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
    deleteEvent: (id: number) => ipcRenderer.invoke('timetable:delete-event', id),
    setSemesterStart: (semester: string, value: string) =>
      ipcRenderer.invoke('timetable:set-semester-start', semester, value),
    syncNow: (semester?: string) => ipcRenderer.invoke('timetable:sync', semester),
  },
  shuiyuan: {
    getState: () => ipcRenderer.invoke('shuiyuan:get-state'),
    startAuth: () => ipcRenderer.invoke('shuiyuan:start-auth'),
    bind: (payload: string) => ipcRenderer.invoke('shuiyuan:bind', payload),
    unbind: () => ipcRenderer.invoke('shuiyuan:unbind'),
    siteStructure: () => ipcRenderer.invoke('shuiyuan:site-structure'),
    listTopics: (feed: ShuiyuanFeed, moreUrl?: string) =>
      ipcRenderer.invoke('shuiyuan:list-topics', feed, moreUrl),
    getTopic: (id: number, postNumber?: number) =>
      ipcRenderer.invoke('shuiyuan:get-topic', id, postNumber),
    loadPosts: (topicId: number, postIds: readonly number[]) =>
      ipcRenderer.invoke('shuiyuan:load-posts', topicId, [...postIds]),
    listBookmarks: () => ipcRenderer.invoke('shuiyuan:list-bookmarks'),
    listMessages: () => ipcRenderer.invoke('shuiyuan:list-messages'),
    listNotifications: () => ipcRenderer.invoke('shuiyuan:list-notifications'),
    markNotificationsRead: () => ipcRenderer.invoke('shuiyuan:mark-notifications-read'),
    getCounts: () => ipcRenderer.invoke('shuiyuan:get-counts'),
    createReply: (topicId: number, raw: string, replyToPostNumber?: number) =>
      ipcRenderer.invoke('shuiyuan:create-reply', topicId, raw, replyToPostNumber),
    uploadFile: (fileName: string, base64: string) =>
      ipcRenderer.invoke('shuiyuan:upload-file', fileName, base64),
    createMessage: (to: readonly string[], title: string, raw: string) =>
      ipcRenderer.invoke('shuiyuan:create-message', [...to], title, raw),
    setBookmarked: (topicId: number, on: boolean) =>
      ipcRenderer.invoke('shuiyuan:set-bookmarked', topicId, on),
    addSourceRef: (topicId: number) => ipcRenderer.invoke('shuiyuan:add-source-ref', topicId),
    getSourceRef: (topicId: number) => ipcRenderer.invoke('shuiyuan:get-source-ref', topicId),
    readSource: (topicId: number) => ipcRenderer.invoke('shuiyuan:read-source', topicId),
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
    newChat: (scope: string) => ipcRenderer.invoke('workspace:new-chat', scope),
    listChats: (scope: string, query: string) =>
      ipcRenderer.invoke('workspace:list-chats', scope, query),
    openChat: (scope: string, sessionId: string) =>
      ipcRenderer.invoke('workspace:open-chat', scope, sessionId),
    deleteChat: (scope: string, sessionId: string) =>
      ipcRenderer.invoke('workspace:delete-chat', scope, sessionId),
    ask: (scope: string, prompt: string, context: string[]) =>
      ipcRenderer.invoke('workspace:ask', scope, prompt, context),
    cancelAsk: (scope: string) => ipcRenderer.invoke('workspace:cancel-ask', scope),
    onChatUpdate: (listener: (scope: string, chat: WorkspaceChat) => void) => {
      const subscription = (_event: unknown, scope: string, chat: WorkspaceChat) =>
        listener(scope, chat);
      ipcRenderer.on('workspace:chat-update', subscription);
      return () => {
        ipcRenderer.removeListener('workspace:chat-update', subscription);
      };
    },
  },
} satisfies DelaApi);
