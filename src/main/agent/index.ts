// agent 域入口：注册 session:* / chat:* / llm:* / capabilities:* 通道。
// 会话、工具、压缩、skills 发现都在 Pi 里；这里只做 IPC 参数校验与转发。
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setLlmProviderEnabled,
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
  forkSession,
  hasLiveSessions as hasLiveMainSessions,
  invalidateSessions,
  listSessionCommands,
  shutdownSessions as shutdownMainSessions,
  listSessions,
  newSession,
  openSession,
  openSessionFile,
  openSessionFileInVsCode,
  listSessionTurnChanges,
  readSessionTurnChanges,
  readSessionTurnFileChange,
  readSessionUncommittedChanges,
  readSessionUncommittedFileChange,
  uncommittedAvailability,
  locateSessionFile,
  preloadPi,
  revealSessionFile,
  runSessionCommand,
  setSessionEffort,
  setSessionModel,
  subscribeChat,
  updateSessionVisibility,
} from './session';
import { registerPackagesIpc } from './packages-ipc';
import {
  askSidechat,
  cancelSidechat,
  closeSidechat,
  hasSidechats,
  keepSidechat,
  openSidechat,
  shutdownSidechats,
} from './sidechat';
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
  findSkill,
  listSkills,
  readSkill,
  revealSkill,
  setGlobalSkillEnabled,
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
import {
  listWebSearchEntries,
  listWebSearchKeySources,
  listWebSearchOptions,
  readWebSearchKey,
  removeWebSearchEntry,
  saveWebSearchEntry,
  selectWebSearchEntry,
  webSearchEntryInputSchema,
} from './web-search';

export { closeDomainBridge, domainBridge } from './environment';
export {
  gcChatMedia,
  hasLiveSessions,
  invalidateSessions,
  loadPi,
  shutdownSessions,
  subscribeChat,
};

function hasLiveSessions() {
  return hasLiveMainSessions() || hasSidechats();
}

/** 退出前结束主会话与旁问，最多等 timeoutMs。 */
async function shutdownSessions(timeoutMs: number) {
  await Promise.race([
    Promise.all([shutdownMainSessions(timeoutMs), shutdownSidechats()]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

const uuid = z.string().uuid();
const askInputSchema = z.object({
  text: z.string().max(20000),
  attachments: z.array(uuid).max(5),
  // 引用以 @token 内联在正文里、无数量上限（受 text 长度约束）；附件维持 5 个上限。
  context: z.array(z.string().max(32_767)),
  comments: z.array(
    z.object({ quote: z.string().trim().min(1).max(20000), comment: z.string().max(20000) }),
  ),
  replaceLastUser: z.boolean().optional(),
});

/** 模型/能力配置写入后让空闲会话按新配置重建。 */
function invalidating<T>(fn: () => T): T {
  const result = fn();
  if (result instanceof Promise) return result.finally(invalidateSessions) as T;
  invalidateSessions();
  return result;
}

function changingWebSearch<T>(fn: () => T): T {
  const result = invalidating(fn);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('capabilities:web-search-changed');
  }
  return result;
}

export function registerAgentIpc() {
  void preloadPi();
  registerPackagesIpc();
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
  sessionHandle('fork', (id, entryId) =>
    forkSession(uuid.parse(id), z.string().min(1).max(64).parse(entryId)),
  );
  const sidechatHandle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`sidechat:${name}`, async (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      await preloadPi();
      return fn(...args);
    });
  sidechatHandle('open', (id) => openSidechat(uuid.parse(id)));
  sidechatHandle('ask', (id, input) =>
    askSidechat(uuid.parse(id), askInputSchema.omit({ replaceLastUser: true }).parse(input)),
  );
  sidechatHandle('cancel', (id) => cancelSidechat(uuid.parse(id)));
  sidechatHandle('close', (id) => closeSidechat(uuid.parse(id)));
  sidechatHandle('keep', (id) => keepSidechat(uuid.parse(id)));
  sessionHandle('set-model', (id, providerId, model) =>
    setSessionModel(
      uuid.parse(id),
      uuid.parse(providerId),
      z.string().min(1).max(200).parse(model),
    ),
  );
  sessionHandle('set-effort', (id, level) =>
    setSessionEffort(uuid.parse(id), z.string().min(1).max(16).parse(level)),
  );
  sessionHandle('run-command', (id, name, args) =>
    runSessionCommand(
      uuid.parse(id),
      z.enum(['compact', 'reload', 'name']).parse(name),
      z.string().max(2000).parse(args),
    ),
  );

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
  chatHandle('list-session-commands', async (event, sessionId) => {
    subscribeChat(event.sender);
    await preloadPi();
    return listSessionCommands(uuid.parse(sessionId));
  });
  chatHandle('save-command', (_event, input) => saveChatCommand(input));
  chatHandle('delete-command', (_event, id) => deleteChatCommand(uuid.parse(id)));
  // 路径由会话 cwd 限定；locate-file 返回本机绝对路径供应用内预览标签使用。
  const chatFilePath = (path: unknown) => z.string().min(1).max(32_767).parse(path);
  chatHandle('locate-file', (_event, sessionId, path) =>
    locateSessionFile(uuid.parse(sessionId), chatFilePath(path)),
  );
  chatHandle('open-in-vscode', (_event, sessionId, path) =>
    openSessionFileInVsCode(uuid.parse(sessionId), chatFilePath(path)),
  );
  chatHandle('reveal-file', (_event, sessionId, path) =>
    revealSessionFile(uuid.parse(sessionId), chatFilePath(path)),
  );
  chatHandle('list-turn-changes', (_event, sessionId) =>
    listSessionTurnChanges(uuid.parse(sessionId)),
  );
  chatHandle('read-turn-changes', (_event, sessionId, turnId, includeStats) =>
    readSessionTurnChanges(
      uuid.parse(sessionId),
      uuid.parse(turnId),
      z.boolean().optional().parse(includeStats),
    ),
  );
  chatHandle('read-turn-file-change', (_event, sessionId, turnId, path) =>
    readSessionTurnFileChange(uuid.parse(sessionId), uuid.parse(turnId), chatFilePath(path)),
  );
  chatHandle('read-uncommitted-changes', (_event, sessionId) =>
    readSessionUncommittedChanges(uuid.parse(sessionId)),
  );
  chatHandle('uncommitted-availability', (_event, sessionId) =>
    uncommittedAvailability(uuid.parse(sessionId)),
  );
  chatHandle('read-uncommitted-file-change', (_event, sessionId, path) =>
    readSessionUncommittedFileChange(uuid.parse(sessionId), chatFilePath(path)),
  );
  chatHandle('open-file', (_event, sessionId, path) =>
    openSessionFile(uuid.parse(sessionId), chatFilePath(path)),
  );

  handle('llm:list', () => listLlmProviders());
  // 提供商配置只影响用它的会话；停用与删除也一样，那些会话下次使用时会提示另选模型。
  handle('llm:save', (input) => {
    const saved = saveLlmProvider(input);
    invalidateSessions(saved.id);
    return saved;
  });
  handle('llm:remove', (id) => {
    const providerId = uuid.parse(id);
    removeLlmProvider(providerId);
    invalidateSessions(providerId);
  });
  handle('llm:set-enabled', (id, enabled) => {
    const providerId = uuid.parse(id);
    setLlmProviderEnabled(providerId, z.boolean().parse(enabled));
    invalidateSessions(providerId);
  });
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
      await setGlobalSkillEnabled(DOCUMENT_SKILL, true);
      return listSkills();
    });
  });
  handle('capabilities:cancel-skill-installation', (skill) => {
    z.literal(DOCUMENT_SKILL).parse(skill);
    cancelDocumentInstallation();
  });
  // Skill 的 id 是清单里的 SKILL.md 路径；主进程按清单解析，不接受清单外的路径。
  const skillId = z.string().min(1).max(32_767);
  handle('capabilities:set-skill-enabled', (skill, enabled) =>
    invalidating(() => setSkillEnabled(skillId.parse(skill), z.boolean().parse(enabled))),
  );
  handle('capabilities:read-skill', (skill) => readSkill(skillId.parse(skill)));
  handle('capabilities:reveal-skill', (skill) => revealSkill(skillId.parse(skill)));
  handle('capabilities:upload-skill-to-remote', (skill, remotePath, overwrite) =>
    invalidating(async () => {
      const found = await findSkill(skillId.parse(skill));
      const skillName = name
        .refine((value) => !/[/\\]/.test(value) && value !== '.' && value !== '..')
        .parse(found.name);
      if (skillName === DOCUMENT_SKILL) throw new Error('文档读取组件仅在本机使用');
      const project = remoteProjectOf(z.string().trim().min(1).max(4096).parse(remotePath));
      if (!project) throw new Error('目标不是远端项目路径');
      return uploadSkillToRemote({
        target: targetOf(remoteById(project.remoteId)),
        skillDir: skillDirectory(found),
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
    changingWebSearch(() => setBuiltinCapabilities([name.parse(tool)], z.boolean().parse(enabled))),
  );
  handle('capabilities:set-builtin-domain', (domain, enabled) =>
    changingWebSearch(() =>
      setBuiltinCapabilities(domainTools(name.parse(domain)), z.boolean().parse(enabled)),
    ),
  );
  handle('capabilities:list-web-search-entries', () => listWebSearchEntries());
  handle('capabilities:list-web-search-options', () => listWebSearchOptions());
  // 搜索配置变更同时刷新会话工具与各窗口的选择器。
  handle('capabilities:save-web-search-entry', (entry) =>
    changingWebSearch(() => saveWebSearchEntry(webSearchEntryInputSchema.parse(entry))),
  );
  handle('capabilities:remove-web-search-entry', (id) =>
    changingWebSearch(() => removeWebSearchEntry(uuid.parse(id))),
  );
  handle('capabilities:select-web-search-entry', (id) =>
    changingWebSearch(() => selectWebSearchEntry(id === null ? null : uuid.parse(id))),
  );
  handle('capabilities:list-web-search-key-sources', () => listWebSearchKeySources());
  handle('capabilities:read-web-search-key', (providerId) =>
    readWebSearchKey(uuid.parse(providerId)),
  );
}
