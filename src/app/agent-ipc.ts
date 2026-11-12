// agent 域入口：注册 Agent 协议与桌面私有的 session:* / chat:* / llm:* / capabilities:* 通道。
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../main/ipc';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setLlmProviderEnabled,
  verifyLlm,
  verifyLlmModel,
} from '../core/agent/providers';
import { agentContract } from '../core/protocol/agent';
import { channelsOf } from '../core/protocol/contract';
import { deleteChatCommand, saveChatCommand } from '../core/agent/chat-commands';
import { agentProtocol } from '../core/agent/protocol';
import {
  archiveProjectSessions,
  deleteSession,
  updateSessionVisibility,
} from '../core/agent/session/commands';
import {
  openSessionFile,
  readSessionUncommittedChanges,
  readSessionUncommittedFileChange,
  uncommittedAvailability,
  locateSessionFile,
  revealSessionFile,
} from '../core/agent/session/files';
import {
  hasLiveSessions as hasLiveMainSessions,
  invalidateSessions,
  shutdownSessions as shutdownMainSessions,
} from '../core/agent/session/run';
import { archivedSessions, preloadPi } from '../core/agent/session/store';
import { hostPorts } from '../core/ports';
import { exportSession } from '../core/agent/session-export';
import { hasSidechats, shutdownSidechats } from '../core/agent/sidechat';
import { stageChatMediaFiles, gcChatMedia } from '../core/agent/media';
import {
  findSkill,
  listSkills,
  readSkill,
  revealSkill,
  setGlobalSkillEnabled,
  setSkillEnabled,
  skillDirectory,
} from '../core/capabilities/skills';
import {
  DOCUMENT_SKILL,
  cancelDocumentInstallation,
  installDocumentDependency,
} from '../main/documents/runtime';
import { remoteById, targetOf } from '../main/remotes/api';
import { uploadSkillToRemote } from '../core/remote/context';
import { remoteProjectOf } from '../main/workspace/api';
import { openInVsCode } from '../main/workspace/project';
import {
  addMcpServer,
  listMcpServers,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  refreshMcpServer,
  removeMcpServer,
  updateMcpServer,
} from '../core/capabilities/mcp';
import {
  domainTools,
  listBuiltinCapabilities,
  setBuiltinCapabilities,
} from '../core/capabilities/tools';
import { readSubagentLimit, setSubagentLimit } from '../core/agent/subagent';
import { llmCatalog, loadPi } from '../core/agent/pi';
import {
  listWebSearchEntries,
  listWebSearchKeySources,
  listWebSearchOptions,
  readWebSearchKey,
  removeWebSearchEntry,
  saveWebSearchEntry,
  selectWebSearchEntry,
  webSearchEntryInputSchema,
} from '../core/capabilities/web-search';

export { closeDomainBridge, domainBridge } from '../core/agent/environment';
export { gcChatMedia, hasLiveSessions, invalidateSessions, loadPi, shutdownSessions };

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

/** 模型/能力配置写入后让空闲会话按新配置重建。 */
function invalidating<T>(fn: () => T): T {
  const result = fn();
  if (result instanceof Promise) return result.finally(invalidateSessions) as T;
  invalidateSessions();
  return result;
}

function changingWebSearch<T>(fn: () => T): T {
  const result = invalidating(fn);
  hostPorts().desktop.sendToWindows('capabilities:web-search-changed');
  return result;
}

export function registerAgentIpc() {
  void preloadPi();
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  // 调用过协议的窗口才收得到会话事件。
  for (const channel of channelsOf(agentContract)) {
    const name = channel.slice(agentContract.namespace.length + 1);
    ipcMain.handle(channel, async (event, input: unknown) => {
      checkWorkspaceSender(event);
      hostPorts().broadcaster.subscribe(event.sender);
      await preloadPi();
      return agentProtocol.call(name, input);
    });
  }

  const sessionHandle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`session:${name}`, async (event, ...args) => {
      checkWorkspaceSender(event);
      hostPorts().broadcaster.subscribe(event.sender);
      await preloadPi();
      return fn(...args);
    });
  const projectId = uuid.nullable();
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
  ipcMain.handle('session:export', (event, id) => {
    checkWorkspaceSender(event);
    return exportSession(uuid.parse(id), event.sender);
  });
  sessionHandle('remove', (id) => {
    const sessionId = uuid.parse(id);
    if (!archivedSessions().some((session) => session.id === sessionId))
      throw new Error('请先归档，再从设置中永久删除');
    return deleteSession(sessionId);
  });

  const chatHandle = (
    name: string,
    fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) =>
    ipcMain.handle(`chat:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(event, ...args);
    });
  chatHandle('pick-media', async (event) => {
    return stageChatMediaFiles(await hostPorts().desktop.pickFiles(event.sender));
  });
  chatHandle('save-command', (_event, input) => saveChatCommand(input));
  chatHandle('delete-command', (_event, id) => deleteChatCommand(uuid.parse(id)));
  // 路径由会话 cwd 限定；locate-file 返回本机绝对路径供应用内预览标签使用。
  const chatFilePath = (path: unknown) => z.string().min(1).max(32_767).parse(path);
  chatHandle('locate-file', (_event, sessionId, path) =>
    locateSessionFile(uuid.parse(sessionId), chatFilePath(path)),
  );
  chatHandle('open-in-vscode', (_event, sessionId, path) =>
    openInVsCode(locateSessionFile(uuid.parse(sessionId), chatFilePath(path))),
  );
  chatHandle('reveal-file', (_event, sessionId, path) =>
    revealSessionFile(uuid.parse(sessionId), chatFilePath(path)),
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

  handle('llm:catalog', () => llmCatalog());
  handle('llm:list', () => listLlmProviders());
  // 提供商配置只影响用它的会话；停用与删除也一样，那些会话下次使用时会提示另选模型。
  handle('llm:save', async (input) => {
    const saved = await saveLlmProvider(input);
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
  handle('capabilities:get-subagent-limit', () => readSubagentLimit());
  handle('capabilities:set-subagent-limit', (limit) => setSubagentLimit(limit));
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
