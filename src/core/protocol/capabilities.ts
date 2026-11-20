// 桌面私有的能力视图（Skills、MCP、联网搜索）：不进入 Agent 协议的 JSON Schema，也不带版本。
import { z } from 'zod';
import { providerIdSchema } from './agent';
import { defineContract } from './contract';

/** Skill 来处：builtin 为 Dela 写入 ~/.dela/skills 的内置技能，user 为本机用户目录，project 为本地项目目录。 */
export type SkillOrigin = 'builtin' | 'user' | 'project';

export interface SkillDependency {
  status: 'missing' | 'installing' | 'ready' | 'error';
  phase?: string;
  received?: number;
  total?: number;
  error?: string;
}

/** 已发现的 Skill（同名时项目覆盖全局）。 */
export interface SkillView {
  /** 唯一标识，即 SKILL.md 的绝对路径：启停、查看与上传都用它（主进程只认清单里有的）。 */
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  path: string;
  origin: SkillOrigin;
  group?: { id: string; label: string };
  dependency?: SkillDependency;
}

export type McpConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type McpTransportConfig =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> };

/** MCP 服务器配置：只存在主进程，保存在 ~/.dela/mcp.json，id 就是名字。 */
export type McpServerConfig = { id: string; name: string; enabled: boolean } & McpTransportConfig;

export type McpServerInput = { name: string } & McpTransportConfig;

/** 传输方式创建后不变；连接字段留空即保持原值。 */
export interface McpServerPatch {
  name?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** MCP 服务器的运行视图：不含命令、地址与密钥。 */
export interface McpServerView {
  id: string;
  name: string;
  transport: McpTransportConfig['transport'];
  enabled: boolean;
  status: McpConnectionStatus;
  toolCount: number | null;
  error: string | null;
}

export interface AgentCapabilityView {
  name: string;
  label: string;
  domain: string;
  domainLabel: string;
  description: string;
  enabled: boolean;
  /** 常驻能力：被其他工具依赖，不可关闭（UI 只读展示 + 原因）。 */
  lockedReason?: string;
}

/** WebSearch 搜索服务配置条目（同类型可存多条）；当前使用哪条由聊天输入框的选择记录，设置页只做增删改。 */
export type WebSearchEntry =
  | { id: string; name: string; provider: 'brave'; apiKey: string }
  | { id: string; name: string; provider: 'google'; apiKey: string; cx: string }
  | {
      id: string;
      name: string;
      provider: 'custom';
      url: string;
      body?: string;
      headers?: Record<string, string>;
    }
  | { id: string; name: string; provider: 'deepseek'; apiKey: string; useForFetch: boolean };

/** 保存入参：id 省略表示新建（新建即选中）。Omit 需分布到各判别分支，否则丢失判别字段。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WebSearchEntryInput = DistributiveOmit<WebSearchEntry, 'id'> & { id?: string };

export interface WebSearchEntrySummary {
  id: string;
  name: string;
  provider: WebSearchEntry['provider'];
}

export interface WebSearchKeySource {
  id: string;
  name: string;
}

export interface RemoteSkillUpload {
  path: string;
  files: number;
}

/** 联网搜索条目沿用模型服务 id 的规则；MCP 服务器以名字为 id。 */
const id = providerIdSchema;
const mcpServerId = z.string().min(1).max(60);
const name = z.string().trim().min(1).max(100);
/** Skill 的 id 是清单里的 SKILL.md 路径；主进程按清单解析，不接受清单外的路径。 */
const skillId = z.string().min(1).max(32_767);
const skills = z.custom<SkillView[]>();
const mcpServers = z.custom<McpServerView[]>();
const builtins = z.custom<AgentCapabilityView[]>();
const webSearchEntries = z.custom<WebSearchEntry[]>();

/** MCP 与联网搜索的配置由主进程按各自 schema 校验；改动后空闲会话按新配置重建。 */
export const capabilitiesContract = defineContract(
  'capabilities',
  {
    listSkills: { input: z.undefined(), output: skills },
    setSkillEnabled: { input: z.object({ id: skillId, enabled: z.boolean() }), output: skills },
    installSkillDependencies: { input: z.string(), output: skills },
    cancelSkillInstallation: { input: z.string(), output: z.void() },
    readSkill: { input: skillId, output: z.string() },
    revealSkill: { input: skillId, output: z.void() },
    /** 目标已存在且 overwrite 为 false 时抛「远端已存在：…」，供界面二次确认。 */
    uploadSkillToRemote: {
      input: z.object({
        id: skillId,
        remotePath: z.string().trim().min(1).max(4096),
        overwrite: z.boolean(),
      }),
      output: z.custom<RemoteSkillUpload>(),
    },
    listMcpServers: { input: z.undefined(), output: mcpServers },
    addMcpServer: { input: z.custom<McpServerInput>(), output: mcpServers },
    updateMcpServer: {
      input: z.object({ id: mcpServerId, patch: z.custom<McpServerPatch>() }),
      output: mcpServers,
    },
    removeMcpServer: { input: mcpServerId, output: mcpServers },
    refreshMcpServer: { input: mcpServerId, output: mcpServers },
    listBuiltinCapabilities: { input: z.undefined(), output: builtins },
    setBuiltinCapability: { input: z.object({ name, enabled: z.boolean() }), output: builtins },
    setBuiltinDomain: { input: z.object({ domain: name, enabled: z.boolean() }), output: builtins },
    /** 全应用同时运行的子 Agent 上限（同步与后台合计）。 */
    subagentLimit: { input: z.undefined(), output: z.number() },
    setSubagentLimit: { input: z.number(), output: z.number() },
    listWebSearchEntries: { input: z.undefined(), output: webSearchEntries },
    listWebSearchOptions: {
      input: z.undefined(),
      output: z.custom<{ entries: WebSearchEntrySummary[]; selectedId: string | null }>(),
    },
    saveWebSearchEntry: { input: z.custom<WebSearchEntryInput>(), output: webSearchEntries },
    /** 删的是选中项时回落到剩余第一条。 */
    removeWebSearchEntry: { input: id, output: webSearchEntries },
    /** 选择即启用 web_search 工具；null 表示关闭联网搜索。 */
    selectWebSearchEntry: { input: id.nullable(), output: z.void() },
    listWebSearchKeySources: { input: z.undefined(), output: z.custom<WebSearchKeySource[]>() },
    /** 表单预填用的静态副本，不随供应商换 Key 更新；供应商不可用时为 null。 */
    readWebSearchKey: { input: id, output: z.custom<string | null>() },
  },
  {
    webSearchChanged: z.undefined(),
    /** ~/.dela 下的配置文件被 Dela 以外的工具改动后推送最新列表。 */
    listMcpServers: mcpServers,
    listWebSearchEntries: webSearchEntries,
  },
);
