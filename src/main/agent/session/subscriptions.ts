import type { WebContents } from 'electron';
import type { WorkspaceChat } from '../../../shared/api';
import { getChat } from './store';

const chatClients = new Set<WebContents>();

export function publishChat(scope: string, partial?: Partial<WorkspaceChat>) {
  const chat = { ...getChat(scope), ...partial };
  for (const client of chatClients) {
    if (!client.isDestroyed()) client.send('workspace:chat-update', scope, chat);
  }
}

export function subscribeChat(client: WebContents) {
  if (chatClients.has(client)) return;
  chatClients.add(client);
  client.once('destroyed', () => chatClients.delete(client));
}
