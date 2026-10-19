import type { CapabilityApi } from '../shared/capabilities';
import { invoke, on } from './lib';

// capabilities:* 通道透传（主进程实现见 src/main/agent/index.ts）。
export const capabilityApi: CapabilityApi = {
  needsSetup: () => invoke('capabilities:needs-setup'),
  completeSetup: () => invoke('capabilities:complete-setup'),
  listSkills: () => invoke('capabilities:list-skills'),
  setSkillEnabled: (name, enabled) => invoke('capabilities:set-skill-enabled', name, enabled),
  installSkillDependencies: (name) => invoke('capabilities:install-skill-dependencies', name),
  cancelSkillInstallation: (name) => invoke('capabilities:cancel-skill-installation', name),
  readSkill: (name) => invoke('capabilities:read-skill', name),
  revealSkill: (name) => invoke('capabilities:reveal-skill', name),
  uploadSkillToRemote: (name, remotePath, overwrite) =>
    invoke('capabilities:upload-skill-to-remote', name, remotePath, overwrite),
  listMcpServers: () => invoke('capabilities:list-mcp-servers'),
  addMcpServer: (config) => invoke('capabilities:add-mcp-server', config),
  updateMcpServer: (id, patch) => invoke('capabilities:update-mcp-server', id, patch),
  removeMcpServer: (id) => invoke('capabilities:remove-mcp-server', id),
  refreshMcpServer: (id) => invoke('capabilities:refresh-mcp-server', id),
  listBuiltinCapabilities: () => invoke('capabilities:list-builtin-capabilities'),
  setBuiltinCapability: (name, enabled) =>
    invoke('capabilities:set-builtin-capability', name, enabled),
  setBuiltinDomain: (domain, enabled) => invoke('capabilities:set-builtin-domain', domain, enabled),
  listWebSearchEntries: () => invoke('capabilities:list-web-search-entries'),
  listWebSearchOptions: () => invoke('capabilities:list-web-search-options'),
  onWebSearchChanged: (listener) => on('capabilities:web-search-changed', listener),
  saveWebSearchEntry: (entry) => invoke('capabilities:save-web-search-entry', entry),
  removeWebSearchEntry: (id) => invoke('capabilities:remove-web-search-entry', id),
  selectWebSearchEntry: (id) => invoke('capabilities:select-web-search-entry', id),
  listWebSearchKeySources: () => invoke('capabilities:list-web-search-key-sources'),
  readWebSearchKey: (providerId) => invoke('capabilities:read-web-search-key', providerId),
};
