import { ipcRenderer } from 'electron';
import type {
  ChatAskInput,
  ChatQueueEvent,
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
  list: (projectId: string | null, query = '') =>
    invoke('agent:list-sessions', { projectId, query }),
  create: (projectId: string | null, scope: ChatScope) =>
    invoke('agent:create-session', { projectId, scope }),
  open: (sessionId: string) => invoke('agent:open-session', { sessionId }),
  export: (sessionId: string) => invoke('session:export', sessionId),
  remove: (sessionId: string) => invoke('session:remove', sessionId),
  ask: (sessionId: string, input: ChatAskInput) => invoke('agent:ask', { ...input, sessionId }),
  cancelRun: (sessionId: string) => invoke('agent:cancel-run', { sessionId }),
  withdrawQueued: (sessionId: string) => invoke('agent:withdraw-queued', { sessionId }),
  stopTask: (sessionId: string, taskId: string) => invoke('agent:stop-task', { sessionId, taskId }),
  runCommand: (sessionId: string, name: MainSessionCommand, args: string) =>
    invoke('agent:run-command', { sessionId, name, args }),
  fork: (sessionId: string, entryId: string) => invoke('agent:fork', { sessionId, entryId }),
  setModel: (sessionId: string, providerId: string, model: string) =>
    invoke('agent:set-model', { sessionId, providerId, model }),
  setEffort: (sessionId: string, level: string) => invoke('agent:set-effort', { sessionId, level }),
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
  onQueue: (listener: (event: ChatQueueEvent) => void) => on('session:on-queue', listener),
} satisfies SessionApi;

export const sidechat = {
  open: (parentId: string) => invoke('agent:open-sidechat', { parentId }),
  ask: (parentId: string, input: ChatAskInput) =>
    invoke('agent:ask-sidechat', { ...input, parentId }),
  cancel: (parentId: string) => invoke('agent:cancel-sidechat', { parentId }),
  close: (parentId: string) => invoke('agent:close-sidechat', { parentId }),
  keep: (parentId: string) => invoke('agent:keep-sidechat', { parentId }),
  onUpdate: (listener: (view: SidechatView) => void) => on('sidechat:on-update', listener),
  onStream: (listener: (event: ChatStreamEvent) => void) => on('sidechat:on-stream', listener),
  onClosed: (listener: (parentId: string) => void) => on('sidechat:on-closed', listener),
} satisfies SidechatApi;
