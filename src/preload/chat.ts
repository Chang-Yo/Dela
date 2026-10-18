import type { ChatApi, ChatCommandView, ChatMediaView } from '../shared/api';
import { invoke } from './lib';

export const chat = {
  stageMedia: (input: { name: string; bytes: ArrayBuffer | Uint8Array }) =>
    invoke('chat:stage-media', input) as Promise<ChatMediaView>,
  pickMedia: () => invoke('chat:pick-media') as Promise<ChatMediaView[]>,
  readMediaPreview: (id: string) => invoke('chat:read-media-preview', id) as Promise<string | null>,
  releaseMedia: (ids: readonly string[]) => invoke('chat:release-media', ids),
  listCommands: () => invoke('chat:list-commands') as Promise<ChatCommandView[]>,
  saveCommand: (input: { id?: string; name: string; prompt: string }) =>
    invoke('chat:save-command', input) as Promise<ChatCommandView>,
  deleteCommand: (id: string) => invoke('chat:delete-command', id),
  revealFile: (sessionId: string, path: string) => invoke('chat:reveal-file', sessionId, path),
  openFile: (sessionId: string, path: string) => invoke('chat:open-file', sessionId, path),
} satisfies ChatApi;
