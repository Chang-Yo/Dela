import { ipcRenderer, webUtils } from 'electron';
import type {
  ChatAskInput,
  OfficeExportEvent,
  WorkspaceApi,
  WorkspaceChat,
  WorkspaceCreateInput,
  WorkspaceViewState,
} from '../shared/api';
import type { ResourceRef } from '../shared/resources';
import { invoke, on } from './lib';

export const workspace = {
  getState: () => invoke('workspace:get-state'),
  create: (input: WorkspaceCreateInput) => invoke('workspace:create', input),
  update: (
    id: string,
    input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
  ) => invoke('workspace:update', id, input),
  remove: (id: string) => invoke('workspace:remove', id),
  read: (id: string) => invoke('workspace:read', id),
  saveNote: (id: string, text: string, revision: string) =>
    invoke('workspace:save-note', id, text, revision),
  saveNoteImage: (id: string, name: string, bytes: Uint8Array) =>
    invoke('workspace:save-note-image', id, name, bytes) as Promise<string>,
  createNoteCopy: (id: string, parentId?: string | null) =>
    invoke('workspace:create-note-copy', id, parentId ?? null),
  openExternal: (id: string) =>
    invoke('workspace:open-external', id) as Promise<'vscode' | 'system'>,
  exportOfficePdf: (ref: ResourceRef) => invoke('workspace:export-office-pdf', ref),
  onOfficeExportProgress: (listener: (event: OfficeExportEvent) => void) =>
    on<OfficeExportEvent>('workspace:export-office-progress', listener),
  quickLookFile: (ref: ResourceRef) => invoke('workspace:quick-look', ref),
  importFiles: (parentId: string | null) => invoke('workspace:import-files', parentId),
  importDroppedFiles: (parentId: string | null, files: File[]) => {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return paths.length
      ? invoke('workspace:import-dropped-files', parentId, paths)
      : Promise.resolve();
  },
  openLocal: (id: string) => invoke('workspace:open-local', id),
  chooseDirectory: () => invoke('workspace:choose-directory'),
  saveView: (scope: string, state: WorkspaceViewState) =>
    invoke('workspace:save-view', scope, state),
  getChat: (scope: string) => invoke('workspace:get-chat', scope),
  newChat: (scope: string) => invoke('workspace:new-chat', scope),
  listChats: (scope: string, query: string) => invoke('workspace:list-chats', scope, query),
  openChat: (scope: string, sessionId: string) => invoke('workspace:open-chat', scope, sessionId),
  deleteChat: (scope: string, sessionId: string) =>
    invoke('workspace:delete-chat', scope, sessionId),
  ask: (scope: string, input: ChatAskInput) => invoke('workspace:ask', scope, input),
  editAsk: (scope: string, text: string) =>
    invoke('workspace:ask', scope, {
      text,
      attachments: [],
      context: [],
      replaceLastUser: true,
    }),
  cancelAsk: (scope: string) => invoke('workspace:cancel-ask', scope),
  onChatUpdate: (listener: (scope: string, chat: WorkspaceChat) => void) => {
    // 唯一双载荷订阅（scope + chat），不走 lib.on 的单载荷封装。
    const subscription = (_event: unknown, scope: string, chat: WorkspaceChat) =>
      listener(scope, chat);
    ipcRenderer.on('workspace:chat-update', subscription);
    return () => {
      ipcRenderer.removeListener('workspace:chat-update', subscription);
    };
  },
} satisfies WorkspaceApi;
