import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
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
import {
  listLlmProviders,
  saveLlmProvider,
  removeLlmProvider,
  setActiveLlmProvider,
  setLlmModel,
  setLlmEffort,
  verifyLlm,
} from './providers';

const idSchema = z.string().uuid();

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
  handle('ask', (scope, prompt, context) =>
    ask(
      z.string().max(100).parse(scope),
      z.string().trim().min(1).max(20000).parse(prompt),
      z.array(z.string().max(512)).max(10).parse(context),
    ),
  );
  // LLM 提供商配置通道；save/verify 的对象内字段在 providers.ts 内做 zod 校验。
  const llmHandle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`llm:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  llmHandle('list', () => listLlmProviders());
  llmHandle('save', (input) => saveLlmProvider(input));
  llmHandle('remove', (id) => removeLlmProvider(idSchema.parse(id)));
  llmHandle('set-active', (id) => setActiveLlmProvider(idSchema.parse(id)));
  llmHandle('set-model', (model) => setLlmModel(z.string().trim().min(1).max(200).parse(model)));
  llmHandle('set-effort', (level) => setLlmEffort(z.string().trim().min(1).max(16).parse(level)));
  llmHandle('verify', (input) =>
    verifyLlm(
      z
        .object({
          id: idSchema.optional(),
          baseUrl: z.string(),
          apiKey: z.string().optional(),
        })
        .parse(input),
    ),
  );
}
