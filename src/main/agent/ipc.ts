import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import { saveModelCredential } from '../credentials';
import { getChat, ask, cancelAsk, subscribeChat } from './api';

export function registerAgentIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`workspace:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      return fn(...args);
    });
  handle('get-chat', (scope) => getChat(z.string().max(100).parse(scope)));
  handle('cancel-ask', (scope) => {
    cancelAsk(z.string().max(100).parse(scope));
  });
  handle('configure-model', (key, model) =>
    saveModelCredential(
      z.string().trim().min(1).max(4096).parse(key),
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
