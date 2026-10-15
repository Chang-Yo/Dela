// agent 域入口：注册 session:* / chat:* / llm:* / capabilities:* 通道。
// 会话、工具、压缩、skills 发现都在 Pi 里；这里只做 IPC 参数校验与转发。
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setActiveLlmProvider,
  setLlmEffort,
  setLlmModel,
  verifyLlm,
  verifyLlmModel,
} from './providers';
import { deleteChatCommand, listChatCommands, saveChatCommand } from './chat-commands';
import {
  archiveProjectSessions,
  archivedSessions,
  askSession,
  cancelRun,
  deleteSession,
  invalidateSessions,
  listSessions,
  newSession,
  openSession,
  preloadPi,
  subscribeChat,
  updateSessionVisibility,
} from './session';
import {
  pickChatMedia,
  readChatMediaPreview,
  releaseChatMedia,
  stageChatMedia,
  gcChatMedia,
} from './media';
import {
  completeCapabilitySetup,
  needsCapabilitySetup,
  listSkills,
  readSkill,
  revealSkill,
  setSkillEnabled,
  skillDirectory,
} from './skills';
import {
  DOCUMENT_SKILL,
  cancelDocumentInstallation,
  installDocumentDependency,
} from '../documents/runtime';
import { remoteById, targetOf } from '../remotes/api';
import { uploadSkillToRemote } from '../remotes/context';
import { remoteProjectOf } from '../workspace/api';
import {
  addMcpServer,
  listMcpServers,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  refreshMcpServer,
  removeMcpServer,
  updateMcpServer,
} from './mcp';
import { domainTools, listBuiltinCapabilities, setBuiltinCapabilities } from './tools';
import { loadPi } from './pi';
import { readWebSearchConfig, webSearchConfigSchema, writeWebSearchConfig } from './web-search';

export { closeDomainBridge, domainBridge } from './environment';
export { gcChatMedia, invalidateSessions, loadPi, subscribeChat };

const uuid = z.string().uuid();
const askInputSchema = z.object({
  text: z.string().max(20000),
  attachments: z.array(uuid).max(5),
  // 引用以 @token 内联在正文里、无数量上限（受 text 长度约束）；附件维持 5 个上限。
  context: z.array(z.string().max(32_767)),
  replaceLastUser: z.boolean().optional(),
});

/** 模型/能力配置写入后让空闲会话按新配置重建。 */
function invalidating<T>(fn: () => T): T {
  const result = fn();
  if (result instanceof Promise) return result.finally(invalidateSessions) as T;
  invalidateSessions();
  return result;
}

export function registerAgentIpc() {
  void preloadPi();
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  const sessionHandle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`session:${name}`, async (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      await preloadPi();
      return fn(...args);
    });
  const projectId = uuid.nullable();
  const chatScope = z.enum(['chat', 'library']);

  sessionHandle('list', (id, query) =>
    listSessions(
      projectId.parse(id),
      z
        .string()
        .max(200)
        .parse(query ?? ''),
    ),
  );
  sessionHandle('create', (id, scope) => newSession(projectId.parse(id), chatScope.parse(scope)));
  sessionHandle('archived', () => archivedSessions());
  sessionHandle('update', (id, patch) =>
    updateSessionVisibility(
      uuid.parse(id),
      z
        .object({ archived: z.boolean().optional(), pinned: z.boolean().optional() })
        .strict()
        .parse(patch),
    ),
  );
  sessionHandle('archive-project', (id) => archiveProjectSessions(projectId.parse(id)));
  sessionHandle('open', (id) => openSession(uuid.parse(id)));
  sessionHandle('remove', (id) => {
    const sessionId = uuid.parse(id);
    if (!archivedSessions().some((session) => session.id === sessionId))
      throw new Error('请先归档，再从设置中永久删除');
    return deleteSession(sessionId);
  });
  sessionHandle('ask', (id, input) => askSession(uuid.parse(id), askInputSchema.parse(input)));
  sessionHandle('cancel-run', (id) => cancelRun(uuid.parse(id)));

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
    return owner ? pickChatMedia(owner) : [];
  });
  chatHandle('read-media-preview', (_event, id) => readChatMediaPreview(uuid.parse(id)));
  chatHandle('release-media', (_event, ids) => releaseChatMedia(z.array(uuid).max(24).parse(ids)));
  chatHandle('list-commands', () => listChatCommands());
  chatHandle('save-command', (_event, input) => saveChatCommand(input));
  chatHandle('delete-command', (_event, id) => deleteChatCommand(uuid.parse(id)));

  handle('llm:list', () => listLlmProviders());
  handle('llm:save', (input) => invalidating(() => saveLlmProvider(input)));
  handle('llm:remove', (id) => invalidating(() => removeLlmProvider(uuid.parse(id))));
  handle('llm:set-active', (id) => invalidating(() => setActiveLlmProvider(uuid.parse(id))));
  handle('llm:set-model', (model) =>
    invalidating(() => setLlmModel(z.string().trim().min(1).max(200).parse(model))),
  );
  handle('llm:set-effort', (level) =>
    invalidating(() => setLlmEffort(z.string().trim().min(1).max(16).parse(level))),
  );
  handle('llm:verify-model', (input) => verifyLlmModel(input));
  handle('llm:verify', (input) =>
    verifyLlm(
      z
        .object({ id: uuid.optional(), baseUrl: z.string(), apiKey: z.string().optional() })
        .parse(input),
    ),
  );

  const name = z.string().trim().min(1).max(100);
  handle('capabilities:list-skills', () => listSkills());
  handle('capabilities:needs-setup', () => needsCapabilitySetup());
  handle('capabilities:complete-setup', () => completeCapabilitySetup());
  handle('capabilities:install-skill-dependencies', (skill) => {
    z.literal(DOCUMENT_SKILL).parse(skill);
    return invalidating(async () => {
      await installDocumentDependency();
      return setSkillEnabled(DOCUMENT_SKILL, true);
    });
  });
  handle('capabilities:cancel-skill-installation', (skill) => {
    z.literal(DOCUMENT_SKILL).parse(skill);
    cancelDocumentInstallation();
  });
  handle('capabilities:set-skill-enabled', (skill, enabled) =>
    invalidating(() => setSkillEnabled(name.parse(skill), z.boolean().parse(enabled))),
  );
  handle('capabilities:read-skill', (skill) => readSkill(name.parse(skill)));
  handle('capabilities:reveal-skill', (skill) => revealSkill(name.parse(skill)));
  handle('capabilities:upload-skill-to-remote', (skill, remotePath, overwrite) =>
    invalidating(async () => {
      const skillName = name
        .refine((value) => !/[/\\]/.test(value) && value !== '.' && value !== '..')
        .parse(skill);
      if (skillName === DOCUMENT_SKILL) throw new Error('文档读取组件仅在本机使用');
      const project = remoteProjectOf(z.string().trim().min(1).max(4096).parse(remotePath));
      if (!project) throw new Error('目标不是远端项目路径');
      return uploadSkillToRemote({
        target: targetOf(remoteById(project.remoteId)),
        skillDir: skillDirectory(skillName),
        name: skillName,
        remoteDir: project.path,
        overwrite: z.boolean().parse(overwrite),
      });
    }),
  );
  handle('capabilities:list-mcp-servers', () => listMcpServers());
  handle('capabilities:add-mcp-server', (config) =>
    invalidating(() => addMcpServer(mcpServerInputSchema.parse(config))),
  );
  handle('capabilities:update-mcp-server', (id, patch) =>
    invalidating(() => updateMcpServer(uuid.parse(id), mcpServerPatchSchema.parse(patch))),
  );
  handle('capabilities:remove-mcp-server', (id) =>
    invalidating(() => removeMcpServer(uuid.parse(id))),
  );
  handle('capabilities:refresh-mcp-server', (id) =>
    invalidating(() => refreshMcpServer(uuid.parse(id))),
  );
  handle('capabilities:list-builtin-capabilities', () => listBuiltinCapabilities());
  handle('capabilities:set-builtin-capability', (tool, enabled) =>
    invalidating(() => setBuiltinCapabilities([name.parse(tool)], z.boolean().parse(enabled))),
  );
  handle('capabilities:set-builtin-domain', (domain, enabled) =>
    invalidating(() =>
      setBuiltinCapabilities(domainTools(name.parse(domain)), z.boolean().parse(enabled)),
    ),
  );
  handle('capabilities:read-web-search-config', () => readWebSearchConfig());
  handle('capabilities:write-web-search-config', (config) =>
    writeWebSearchConfig(config === null ? null : webSearchConfigSchema.parse(config)),
  );
}
