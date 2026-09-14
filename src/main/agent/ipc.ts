import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { saveModelCredential } from '../credentials';
import {
  getChat,
  ask,
  cancelAsk,
  subscribeChat,
  newChat,
  listChats,
  openChat,
  deleteChat,
} from './api';

export function registerAgentIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`workspace:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      return fn(...args);
    });
  handle('get-chat', (scope) => getChat(z.string().max(100).parse(scope)));
  handle('new-chat', (scope) => newChat(z.string().max(100).parse(scope)));
  handle('list-chats', (scope, query) =>
    listChats(
      z.string().max(100).parse(scope),
      z
        .string()
        .max(200)
        .parse(query ?? ''),
    ),
  );
  handle('open-chat', (scope, sessionId) =>
    openChat(z.string().max(100).parse(scope), z.string().min(1).max(64).parse(sessionId)),
  );
  handle('delete-chat', (scope, sessionId) =>
    deleteChat(z.string().max(100).parse(scope), z.string().min(1).max(64).parse(sessionId)),
  );
  handle('cancel-ask', (scope) => {
    cancelAsk(z.string().max(100).parse(scope));
  });
  // key 允许为空串：表示仅切换模型，保留已保存的密钥。
  handle('configure-model', (key, model) =>
    saveModelCredential(
      z
        .string()
        .max(4096)
        .parse(key ?? ''),
      z.enum(['deepseek-chat', 'deepseek-reasoner', 'qwen', 'minimax']).parse(model),
    ),
  );
  handle('ask', (scope, prompt, context) =>
    ask(
      z.string().max(100).parse(scope),
      z.string().trim().min(1).max(20000).parse(prompt),
      z.array(z.string().max(512)).max(10).parse(context),
    ),
  );
}
