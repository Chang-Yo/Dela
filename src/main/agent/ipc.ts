import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
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
  listChatCommands,
  saveChatCommand,
  deleteChatCommand,
} from './api';
import { pickChatMedia, readChatMediaPreview, releaseChatMedia, stageChatMedia } from './media';
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
  handle('ask', (scope, input) =>
    ask(
      z.string().max(100).parse(scope),
      z
        .object({
          text: z.string().max(20000),
          attachments: z.array(idSchema).max(5),
          context: z.array(z.string().max(512)).max(10),
        })
        .parse(input),
    ),
  );
  // Composer 暂存文件与自定义指令。
  const chatHandle = (
    name: string,
    fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) =>
    ipcMain.handle(`chat:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event, ...args);
    });
  chatHandle('stage-media', (_event, input) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(255),
        bytes: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
      })
      .parse(input);
    const bytes = parsed.bytes instanceof Uint8Array ? parsed.bytes : new Uint8Array(parsed.bytes);
    return stageChatMedia(
      parsed.name,
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  });
  chatHandle('pick-media', (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return [];
    return pickChatMedia(owner);
  });
  chatHandle('read-media-preview', (_event, id) => readChatMediaPreview(idSchema.parse(id)));
  chatHandle('release-media', (_event, ids) => {
    const parsed = z.array(idSchema).max(24).parse(ids);
    releaseChatMedia(parsed);
  });
  chatHandle('list-commands', () => listChatCommands());
  chatHandle('save-command', (_event, input) => saveChatCommand(input));
  chatHandle('delete-command', (_event, id) => deleteChatCommand(idSchema.parse(id)));
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
