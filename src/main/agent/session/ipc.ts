import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../../ipc';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setActiveLlmProvider,
  setLlmEffort,
  setLlmModel,
  verifyLlm,
  verifyLlmModel,
} from '../core/providers';
import { deleteChatCommand, listChatCommands, saveChatCommand } from './commands';
import {
  askSession,
  cancelRun,
  deleteSession,
  listSessions,
  newSession,
  openSession,
  archivedSessions,
  updateSessionVisibility,
  archiveProjectSessions,
} from './manager';
import { pickChatMedia, readChatMediaPreview, releaseChatMedia, stageChatMedia } from './media';
import { subscribeChat } from './subscriptions';

const idSchema = z.string().uuid();
// v13 原样迁移的旧会话使用 32 位十六进制 ID；附件与项目仍要求 UUID。
const sessionIdSchema = idSchema.or(z.string().regex(/^[a-f0-9]{32}$/i));
const askInputSchema = z.object({
  text: z.string().max(20000),
  attachments: z.array(idSchema).max(5),
  context: z.array(z.string().max(512)).max(10),
  replaceLastUser: z.boolean().optional(),
});

/** 注册 agent 域 IPC 通道：session:*（会话身份）、chat:*（媒体与指令）与 llm:*（模型配置）。 */
export function registerAgentChannels() {
  // 会话通道。
  const sessionHandle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`session:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      return fn(...args);
    });
  const projectIdSchema = z.string().uuid().nullable();
  sessionHandle('list', (projectId, query) =>
    listSessions(
      projectIdSchema.parse(projectId),
      z
        .string()
        .max(200)
        .parse(query ?? ''),
    ),
  );
  sessionHandle('create', (projectId) => newSession(projectIdSchema.parse(projectId)));
  sessionHandle('archived', () => archivedSessions());
  sessionHandle('update', (id, patch) =>
    updateSessionVisibility(
      sessionIdSchema.parse(id),
      z
        .object({ archived: z.boolean().optional(), pinned: z.boolean().optional() })
        .strict()
        .parse(patch),
    ),
  );
  sessionHandle('archive-project', (id) => archiveProjectSessions(projectIdSchema.parse(id)));
  sessionHandle('open', (sessionId) => openSession(sessionIdSchema.parse(sessionId)));
  sessionHandle('remove', (sessionId) => {
    const id = sessionIdSchema.parse(sessionId);
    if (!archivedSessions().some((session) => session.id === id))
      throw new Error('请先归档，再从设置中永久删除');
    deleteSession(id);
  });
  sessionHandle('ask', (sessionId, input) =>
    askSession(sessionIdSchema.parse(sessionId), askInputSchema.parse(input)),
  );
  sessionHandle('cancel-run', (sessionId) => {
    cancelRun(sessionIdSchema.parse(sessionId));
  });
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
  llmHandle('verify-model', (input) => verifyLlmModel(input));
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
