// 桌面私有的能力视图（Skills、MCP、联网搜索）：不进入 Agent 协议的 JSON Schema，也不带版本。
import { z } from 'zod';
import { defineContract } from './contract';

/**
 * Skill 的来处：builtin 是 Dela 写进 ~/.dela/skills 的内置技能；user 是本机目录里用户自己放的
 * （~/.dela/skills 其余条目与 ~/.agents/skills）；project 来自某个本地项目
 * （Pi 认的 .agents/skills、.pi/skills，加上 Dela 认的 .agent/skills）。
 */
export type SkillOrigin = 'builtin' | 'user' | 'project';

export interface SkillDependency {
  status: 'missing' | 'installing' | 'ready' | 'error';
  phase?: string;
  received?: number;
  total?: number;
  error?: string;
}

/** 已发现的 Skill（agentskills.io 规范的 SKILL.md 目录；同名时项目覆盖全局）。 */
export interface SkillView {
  /** 唯一标识，即 SKILL.md 的绝对路径：启停、查看与上传都用它（主进程只认清单里有的）。 */
  id: string;
  name: string;
  /** frontmatter 的 description，进入模型侧索引。 */
  description: string;
  enabled: boolean;
  /** SKILL.md 的绝对路径（供 UI 展示来源）。 */
  path: string;
  origin: SkillOrigin;
  /** origin 为 project 时所属的项目；同组的 Skill 在设置页归在一起。 */
  group?: { id: string; label: string };
  dependency?: SkillDependency;
}

export type McpConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type McpTransportConfig =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> };

/** MCP 服务器配置：只存在主进程，加密保存。 */
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
  /** 已连接时可发现的工具数；未知为 null。 */
  toolCount: number | null;
  error: string | null;
}

/** Agent 内置能力的运行视图（工具表 + 启用态，设置 › 内置能力）。 */
export interface AgentCapabilityView {
  /** 工具名，模型侧唯一标识。 */
  name: string;
  /** 面向人的显示名（设置页标题；工具名降级为次要标识）。 */
  label: string;
  /** 所属领域 id（canvas / mail / …），设置页按域分组与批量开关。 */
  domain: string;
  domainLabel: string;
  /** 提供给模型的工具描述（UI 摘要）。 */
  description: string;
  enabled: boolean;
  /** 常驻能力：被其他工具依赖，不可关闭（UI 只读展示 + 原因）。 */
  lockedReason?: string;
}

/**
 * WebSearch 的搜索服务配置条目（设置 › 内置能力 › 「网络」分组，同类型可存多条）：
 * brave 固定走 Brave 为大模型设计的 LLM Context 端点（res/v1/llm/context）；
 * google 用平台凭据；custom 为任意 JSON 搜索端点，可配 GET/POST 模板与请求头，
 * 结果按常见结构识别；
 * deepseek 用官方自研搜索引擎，useForFetch 决定 web_fetch 是否也走其 Fetch 接口。
 * 当前使用哪一条由聊天输入框左下角的选择记录，设置页只做增删改。
 */
export type WebSearchEntry =
  | { id: string; name: string; provider: 'brave'; apiKey: string }
  | { id: string; name: string; provider: 'google'; apiKey: string; cx: string }
  | {
      id: string;
      name: string;
      provider: 'custom';
      url: string;
      /** JSON 请求体模板；填写即用 POST。 */
      body?: string;
      headers?: Record<string, string>;
    }
  | { id: string; name: string; provider: 'deepseek'; apiKey: string; useForFetch: boolean };

/** 保存入参：id 省略表示新建（新建即选中）。Omit 需分布到各判别分支，否则丢失判别字段。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WebSearchEntryInput = DistributiveOmit<WebSearchEntry, 'id'> & { id?: string };

/** 聊天侧选择器用的脱敏条目：只有标识与类型，不含密钥与自定义请求头。 */
export interface WebSearchEntrySummary {
  id: string;
  name: string;
  provider: WebSearchEntry['provider'];
}

/** 可导入搜索密钥的 DeepSeek 模型供应商（只含标识，不含密钥）。 */
export interface WebSearchKeySource {
  id: string;
  name: string;
}

/** 上传本地 Skill 到远端项目的结果。 */
export interface RemoteSkillUpload {
  /** 远端目标目录，例如 /home/me/proj/.dela/skills/lint。 */
  path: string;
  /** 写入的文件数（含附属文件）。 */
  files: number;
}

const id = z.uuid();
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
    /** 在系统文件管理器中显示 SKILL.md 所在位置。 */
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
    /** 改配置会重连。 */
    updateMcpServer: {
      input: z.object({ id, patch: z.custom<McpServerPatch>() }),
      output: mcpServers,
    },
    removeMcpServer: { input: id, output: mcpServers },
    /** 显式重连并刷新工具列表。 */
    refreshMcpServer: { input: id, output: mcpServers },
    listBuiltinCapabilities: { input: z.undefined(), output: builtins },
    setBuiltinCapability: { input: z.object({ name, enabled: z.boolean() }), output: builtins },
    /** 按领域批量启停，跳过常驻能力。 */
    setBuiltinDomain: { input: z.object({ domain: name, enabled: z.boolean() }), output: builtins },
    /** 全应用同时运行的子 Agent 上限（同步与后台合计）。 */
    subagentLimit: { input: z.undefined(), output: z.number() },
    setSubagentLimit: { input: z.number(), output: z.number() },
    listWebSearchEntries: { input: z.undefined(), output: webSearchEntries },
    /** 聊天侧选择器：脱敏条目与当前选中（工具停用或悬空 id 视为未选）。 */
    listWebSearchOptions: {
      input: z.undefined(),
      output: z.custom<{ entries: WebSearchEntrySummary[]; selectedId: string | null }>(),
    },
    /** 省略 id 为新建，新建即选中。 */
    saveWebSearchEntry: { input: z.custom<WebSearchEntryInput>(), output: webSearchEntries },
    /** 删的是选中项时回落到剩余第一条。 */
    removeWebSearchEntry: { input: id, output: webSearchEntries },
    /** 选择即启用 web_search 工具；null 表示关闭联网搜索。 */
    selectWebSearchEntry: { input: id.nullable(), output: z.void() },
    /** 可导入密钥的 DeepSeek 模型供应商（不含密钥），使用中的排最前。 */
    listWebSearchKeySources: { input: z.undefined(), output: z.custom<WebSearchKeySource[]>() },
    /** 表单预填用的静态副本，不随供应商换 Key 更新；供应商不可用时为 null。 */
    readWebSearchKey: { input: id, output: z.custom<string | null>() },
  },
  {
    /** 搜索配置或内置工具开关变了。 */
    webSearchChanged: z.undefined(),
  },
);
