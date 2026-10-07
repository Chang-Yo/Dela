import type { CapabilityApi } from '../shared/capabilities';
import { invoke } from './lib';

// capabilities:* 通道透传（阶段四；主进程实现见 src/main/agent/capabilities/）。
export const capabilityApi: CapabilityApi = {
  listSkills: () => invoke('capabilities:list-skills'),
  setSkillEnabled: (name, enabled) => invoke('capabilities:set-skill-enabled', name, enabled),
  listMcpServers: () => invoke('capabilities:list-mcp-servers'),
  addMcpServer: (config) => invoke('capabilities:add-mcp-server', config),
  updateMcpServer: (id, patch) => invoke('capabilities:update-mcp-server', id, patch),
  removeMcpServer: (id) => invoke('capabilities:remove-mcp-server', id),
  refreshMcpServer: (id) => invoke('capabilities:refresh-mcp-server', id),
  listBuiltinCapabilities: () => invoke('capabilities:list-builtin-capabilities'),
  setBuiltinCapability: (name, enabled) =>
    invoke('capabilities:set-builtin-capability', name, enabled),
  setBuiltinDomain: (domain, enabled) => invoke('capabilities:set-builtin-domain', domain, enabled),
  readWebSearchConfig: () => invoke('capabilities:read-web-search-config'),
  writeWebSearchConfig: (config) => invoke('capabilities:write-web-search-config', config),
};
