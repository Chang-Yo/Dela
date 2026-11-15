// agent 域入口：注册 Agent 协议与桌面私有的 llm、capabilities 契约；会话的桌面操作在 modules/chat。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../../main/ipc';
import {
  listLlmProviders,
  removeLlmProvider,
  saveLlmProvider,
  setLlmProviderEnabled,
  verifyLlm,
  verifyLlmModel,
} from '../../core/agent/providers';
import { agentContract } from '../../core/protocol/agent';
import { capabilitiesContract } from '../../core/protocol/capabilities';
import { channelsOf, implement } from '../../core/protocol/contract';
import { llmContract } from '../../core/protocol/llm';
import { agentProtocol } from '../../core/agent/protocol';
import {
  hasLiveSessions as hasLiveMainSessions,
  invalidateSessions,
  shutdownSessions as shutdownMainSessions,
} from '../../core/agent/session/run';
import { preloadPi } from '../../core/agent/session/store';
import { emit, hostPorts } from '../../core/ports';
import { hasSidechats, shutdownSidechats } from '../../core/agent/sidechat';
import { gcChatMedia } from '../../core/agent/media';
import {
  findSkill,
  listSkills,
  readSkill,
  revealSkill,
  setGlobalSkillEnabled,
  setSkillEnabled,
  skillDirectory,
} from '../../core/capabilities/skills';
import {
  DOCUMENT_SKILL,
  cancelDocumentInstallation,
  installDocumentDependency,
} from '../../modules/preview';
import { remoteById, targetOf } from '../../modules/remotes';
import { uploadSkillToRemote } from '../../core/remote/context';
import { remoteProjectOf } from '../../modules/workspace';
import {
  addMcpServer,
  listMcpServers,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  refreshMcpServer,
  removeMcpServer,
  updateMcpServer,
} from '../../core/capabilities/mcp';
import {
  domainTools,
  listBuiltinCapabilities,
  setBuiltinCapabilities,
} from '../../core/capabilities/tools';
import { readSubagentLimit, setSubagentLimit } from '../../core/agent/subagent';
import { llmCatalog, loadPi } from '../../core/agent/pi';
import {
  listWebSearchEntries,
  listWebSearchKeySources,
  listWebSearchOptions,
  readWebSearchKey,
  removeWebSearchEntry,
  saveWebSearchEntry,
  selectWebSearchEntry,
  webSearchEntryInputSchema,
} from '../../core/capabilities/web-search';

export { closeDomainBridge, domainBridge } from '../../core/agent/environment';
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

/** 模型/能力配置写入后让空闲会话按新配置重建。 */
function invalidating<T>(fn: () => T): T {
  const result = fn();
  if (result instanceof Promise) return result.finally(invalidateSessions) as T;
  invalidateSessions();
  return result;
}

/** 搜索配置变更同时刷新会话工具与各窗口的选择器。 */
function changingWebSearch<T>(fn: () => T): T {
  const result = invalidating(fn);
  emit(capabilitiesContract, 'webSearchChanged', undefined);
  return result;
}

// 提供商配置只影响用它的会话；停用与删除也一样，那些会话下次使用时会提示另选模型。
const llm = implement(llmContract, {
  catalog: () => llmCatalog(),
  list: () => listLlmProviders(),
  save: async (input) => {
    const saved = await saveLlmProvider(input);
    invalidateSessions(saved.id);
    return saved;
  },
  remove: (id) => {
    removeLlmProvider(id);
    invalidateSessions(id);
  },
  setEnabled: ({ id, enabled }) => {
    setLlmProviderEnabled(id, enabled);
    invalidateSessions(id);
  },
  verify: verifyLlm,
  verifyModel: verifyLlmModel,
});

const capabilities = implement(capabilitiesContract, {
  listSkills: () => listSkills(),
  installSkillDependencies: (skill) => {
    z.literal(DOCUMENT_SKILL).parse(skill);
    return invalidating(async () => {
      await installDocumentDependency();
      await setGlobalSkillEnabled(DOCUMENT_SKILL, true);
      return listSkills();
    });
  },
  cancelSkillInstallation: (skill) => {
    z.literal(DOCUMENT_SKILL).parse(skill);
    cancelDocumentInstallation();
  },
  setSkillEnabled: ({ id, enabled }) => invalidating(() => setSkillEnabled(id, enabled)),
  readSkill,
  revealSkill,
  uploadSkillToRemote: ({ id, remotePath, overwrite }) =>
    invalidating(async () => {
      const found = await findSkill(id);
      const skillName = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .refine((value) => !/[/\\]/.test(value) && value !== '.' && value !== '..')
        .parse(found.name);
      if (skillName === DOCUMENT_SKILL) throw new Error('文档读取组件仅在本机使用');
      const project = remoteProjectOf(remotePath);
      if (!project) throw new Error('目标不是远端项目路径');
      return uploadSkillToRemote({
        target: targetOf(remoteById(project.remoteId)),
        skillDir: skillDirectory(found),
        name: skillName,
        remoteDir: project.path,
        overwrite,
      });
    }),
  listMcpServers: () => listMcpServers(),
  addMcpServer: (config) => invalidating(() => addMcpServer(mcpServerInputSchema.parse(config))),
  updateMcpServer: ({ id, patch }) =>
    invalidating(() => updateMcpServer(id, mcpServerPatchSchema.parse(patch))),
  removeMcpServer: (id) => invalidating(() => removeMcpServer(id)),
  refreshMcpServer: (id) => invalidating(() => refreshMcpServer(id)),
  listBuiltinCapabilities: () => listBuiltinCapabilities(),
  setBuiltinCapability: ({ name, enabled }) =>
    changingWebSearch(() => setBuiltinCapabilities([name], enabled)),
  setBuiltinDomain: ({ domain, enabled }) =>
    changingWebSearch(() => setBuiltinCapabilities(domainTools(domain), enabled)),
  subagentLimit: () => readSubagentLimit(),
  setSubagentLimit,
  listWebSearchEntries: () => listWebSearchEntries(),
  listWebSearchOptions: () => listWebSearchOptions(),
  saveWebSearchEntry: (entry) =>
    changingWebSearch(() => saveWebSearchEntry(webSearchEntryInputSchema.parse(entry))),
  removeWebSearchEntry: (id) => changingWebSearch(() => removeWebSearchEntry(id)),
  selectWebSearchEntry: (id) => changingWebSearch(() => selectWebSearchEntry(id)),
  listWebSearchKeySources: () => listWebSearchKeySources(),
  readWebSearchKey,
});

export function registerAgentIpc() {
  void preloadPi();
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
  for (const ipc of [llm, capabilities])
    for (const name of Object.keys(ipc.contract.procedures))
      ipcMain.handle(`${ipc.contract.namespace}:${name}`, (event, input: unknown) => {
        checkWorkspaceSender(event);
        return ipc.call(name, input);
      });
}
