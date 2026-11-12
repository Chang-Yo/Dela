import type { ChatApi, ChatCommandView, ChatMediaView, UncommittedChanges } from '../shared/api';
import { invoke } from './lib';

export const chat = {
  listTurnChanges: (sessionId: string) => invoke('agent:list-turn-changes', { sessionId }),
  readTurnChanges: (sessionId: string, turnId: string, includeStats = false) =>
    invoke('agent:read-turn-changes', { sessionId, turnId, includeStats }),
  readTurnFileChange: (sessionId: string, turnId: string, path: string) =>
    invoke('agent:read-turn-file-change', { sessionId, turnId, path }),
  readUncommittedChanges: (sessionId: string) => invoke('chat:read-uncommitted-changes', sessionId),
  readUncommittedFileChange: (sessionId: string, path: string) =>
    invoke('chat:read-uncommitted-file-change', sessionId, path),
  uncommittedAvailability: (sessionId: string) =>
    invoke('chat:uncommitted-availability', sessionId) as Promise<
      Pick<UncommittedChanges, 'available' | 'reason'>
    >,
  locateFile: (sessionId: string, path: string) =>
    invoke('chat:locate-file', sessionId, path) as Promise<string>,
  openInVsCode: (sessionId: string, path: string) => invoke('chat:open-in-vscode', sessionId, path),
  stageMedia: (input: { name: string; bytes: ArrayBuffer | Uint8Array }) =>
    invoke('agent:stage-media', input) as Promise<ChatMediaView>,
  pickMedia: () => invoke('chat:pick-media') as Promise<ChatMediaView[]>,
  readMediaPreview: (id: string) =>
    invoke('agent:read-media-preview', { id }) as Promise<string | null>,
  releaseMedia: (ids: readonly string[]) => invoke('agent:release-media', { ids }),
  listCommands: () => invoke('agent:list-commands', {}) as Promise<ChatCommandView[]>,
  saveCommand: (input: { id?: string; name: string; prompt: string }) =>
    invoke('chat:save-command', input) as Promise<ChatCommandView>,
  deleteCommand: (id: string) => invoke('chat:delete-command', id),
  revealFile: (sessionId: string, path: string) => invoke('chat:reveal-file', sessionId, path),
  openFile: (sessionId: string, path: string) => invoke('chat:open-file', sessionId, path),
} satisfies ChatApi;
