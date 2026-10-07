// capabilities:* 通道（阶段四）：Skills 启停与 MCP 服务器管理，载荷形状对齐
// shared/capabilities.ts 的 CapabilityApi 签名；sender 校验与 zod 校验沿用 agent 域惯例。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../../ipc';
import {
  addMcpServer,
  listMcpServers,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  refreshMcpServer,
  removeMcpServer,
  updateMcpServer,
} from './mcp';
import { listSkills, setSkillEnabled } from './skills';
import { listBuiltinCapabilities, setBuiltinCapability, setBuiltinDomain } from './tools';
import { setMcpRouting } from '../tools/registry';
import { mcpToolDefinitions, executeMcpTool } from './mcp';
import {
  readWebSearchConfig,
  webSearchConfigSchema,
  writeWebSearchConfig,
} from '../tools/kernel/websearch';

const skillName = z.string().trim().min(1).max(100);
const serverId = z.string().uuid();
const toolName = z.string().trim().min(1).max(64);
const domainId = z.string().trim().min(1).max(32);

export function registerCapabilitiesIpc() {
  // MCP 工具并集与路由经注入进入 tools/registry（结构 §2.3：capabilities → tools 单向，
  // registry 静态 import capabilities 会与 mcp.ts 的 agentTools 取用成环）。
  setMcpRouting({ mcpToolDefinitions, executeMcpTool });
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`capabilities:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('list-skills', () => listSkills());
  handle('set-skill-enabled', (name, enabled) =>
    setSkillEnabled(skillName.parse(name), z.boolean().parse(enabled)),
  );
  handle('list-mcp-servers', () => listMcpServers());
  handle('add-mcp-server', (config) => addMcpServer(mcpServerInputSchema.parse(config)));
  handle('update-mcp-server', (id, patch) =>
    updateMcpServer(serverId.parse(id), mcpServerPatchSchema.parse(patch)),
  );
  handle('remove-mcp-server', (id) => removeMcpServer(serverId.parse(id)));
  handle('refresh-mcp-server', (id) => refreshMcpServer(serverId.parse(id)));
  handle('list-builtin-capabilities', () => listBuiltinCapabilities());
  handle('set-builtin-capability', (name, enabled) =>
    setBuiltinCapability(toolName.parse(name), z.boolean().parse(enabled)),
  );
  handle('set-builtin-domain', (domain, enabled) =>
    setBuiltinDomain(domainId.parse(domain), z.boolean().parse(enabled)),
  );
  handle('read-web-search-config', () => readWebSearchConfig());
  handle('write-web-search-config', (config) =>
    writeWebSearchConfig(config === null ? null : webSearchConfigSchema.parse(config)),
  );
}
