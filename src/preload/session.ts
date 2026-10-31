import { ipcRenderer } from 'electron';
import type {
  ChatAskInput,
  ChatScope,
  ChatStreamEvent,
  MainSessionCommand,
  RunEvent,
  SessionApi,
  SidechatApi,
  SidechatView,
  WorkspaceChat,
} from '../shared/api';
import { invoke, on } from './lib';

export const session = {
  archived: () => invoke('session:archived'),
  update: (id: string, patch: { archived?: boolean; pinned?: boolean }) =>
    invoke('session:update', id, patch),
  archiveProject: (id: string | null) => invoke('session:archive-project', id),
  list: (projectId: string | null, query = '') => invoke('session:list', projectId, query),
  create: (projectId: string | null, scope: ChatScope) =>
    invoke('session:create', projectId, scope),
  open: (sessionId: string) => invoke('session:open', sessionId),
  remove: (sessionId: string) => invoke('session:remove', sessionId),
  ask: (sessionId: string, input: ChatAskInput) => invoke('session:ask', sessionId, input),
  cancelRun: (sessionId: string) => invoke('session:cancel-run', sessionId),
  runCommand: (sessionId: string, name: MainSessionCommand, args: string) =>
    invoke('session:run-command', sessionId, name, args),
  fork: (sessionId: string, entryId: string) => invoke('session:fork', sessionId, entryId),
  setModel: (sessionId: string, providerId: string, model: string) =>
    invoke('session:set-model', sessionId, providerId, model),
  setEffort: (sessionId: string, level: string) => invoke('session:set-effort', sessionId, level),
  onSessionUpdate: (listener: (sessionId: string, chat: WorkspaceChat) => void) => {
    // 双载荷订阅（sessionId + chat），同 workspace.onChatUpdate 不走 lib.on 的单载荷封装。
    const subscription = (_event: unknown, sessionId: string, chat: WorkspaceChat) =>
      listener(sessionId, chat);
    ipcRenderer.on('session:on-update', subscription);
    return () => {
      ipcRenderer.removeListener('session:on-update', subscription);
    };
  },
  onRunEvent: (listener: (event: RunEvent) => void) => on('session:on-run-event', listener),
  onStream: (listener: (event: ChatStreamEvent) => void) => on('session:on-stream', listener),
} satisfies SessionApi;

export const sidechat = {
  open: (parentId: string) => invoke('sidechat:open', parentId),
  ask: (parentId: string, input: ChatAskInput) => invoke('sidechat:ask', parentId, input),
  cancel: (parentId: string) => invoke('sidechat:cancel', parentId),
  close: (parentId: string) => invoke('sidechat:close', parentId),
  keep: (parentId: string) => invoke('sidechat:keep', parentId),
  onUpdate: (listener: (view: SidechatView) => void) => on('sidechat:on-update', listener),
  onStream: (listener: (event: ChatStreamEvent) => void) => on('sidechat:on-stream', listener),
  onClosed: (listener: (parentId: string) => void) => on('sidechat:on-closed', listener),
} satisfies SidechatApi;
