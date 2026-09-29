import { ipcRenderer } from 'electron';
import type { ChatAskInput, RunEvent, SessionApi, WorkspaceChat } from '../shared/api';
import { invoke, on } from './lib';

export const session = {
  list: (projectId: string | null, query = '') => invoke('session:list', projectId, query),
  create: (projectId: string | null) => invoke('session:create', projectId),
  open: (sessionId: string) => invoke('session:open', sessionId),
  remove: (sessionId: string) => invoke('session:remove', sessionId),
  ask: (sessionId: string, input: ChatAskInput) => invoke('session:ask', sessionId, input),
  cancelRun: (sessionId: string) => invoke('session:cancel-run', sessionId),
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
} satisfies SessionApi;
