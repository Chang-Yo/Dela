// 能力层契约（MCP 与 Skills）：main 拥有连接与启停事实，renderer 只持镜像。

/** Skill 来源范围：global 来自用户主目录（.dela/.agents/.zcode），project 来自当前工作区。 */
export type SkillScope = 'global' | 'project';

export interface SkillDependency {
  status: 'missing' | 'installing' | 'ready' | 'error';
  phase?: string;
  received?: number;
  total?: number;
  error?: string;
}

/** 已发现的 Skill（agentskills.io 规范的 SKILL.md 目录；同名时项目覆盖全局）。 */
export interface SkillView {
  /** 目录名，同时是 ReadSkills 工具的 skill 参数。 */
  name: string;
  /** frontmatter 的 description，进入模型侧索引。 */
  description: string;
  enabled: boolean;
  /** SKILL.md 的绝对路径（供 UI 展示来源）。 */
  path: string;
  scope: SkillScope;
  dependency?: SkillDependency;
}

export type McpConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** MCP 服务器配置（持久化；command/args/env 为 stdio 传输）。 */
export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

/** MCP 服务器的运行视图（配置 + 当前连接状态）。 */
export interface McpServerView {
  id: string;
  name: string;
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
 * google 用平台凭据；custom 为返回 { results: [{ title, url, content }] } JSON
 * （SearXNG 兼容格式）的任意端点，headers 适配用户自备的鉴权/加密策略；
 * deepseek 用官方自研搜索引擎，useForFetch 决定 web_fetch 是否也走其 Fetch 接口。
 * 当前使用哪一条由聊天输入框左下角的选择记录，设置页只做增删改。
 */
export type WebSearchEntry =
  | { id: string; name: string; provider: 'brave'; apiKey: string }
  | { id: string; name: string; provider: 'google'; apiKey: string; cx: string }
  | { id: string; name: string; provider: 'custom'; url: string; headers?: Record<string, string> }
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
  active: boolean;
}

/** 上传本地 Skill 到远端项目的结果。 */
export interface RemoteSkillUpload {
  /** 远端目标目录，例如 /root/proj/.dela/skills/lint。 */
  path: string;
  /** 写入的文件数（含附属文件）。 */
  files: number;
}

export interface CapabilityApi {
  needsSetup(): Promise<boolean>;
  completeSetup(): Promise<void>;
  listSkills(): Promise<SkillView[]>;
  /** 启停 Skill；返回最新列表（未知名抛错）。 */
  setSkillEnabled(name: string, enabled: boolean): Promise<SkillView[]>;
  installSkillDependencies(name: string): Promise<SkillView[]>;
  cancelSkillInstallation(name: string): Promise<void>;
  /** 读取 SKILL.md 全文（按名单独解析，渲染端不传路径）。 */
  readSkill(name: string): Promise<string>;
  /** 在系统文件管理器中显示 SKILL.md 所在位置。 */
  revealSkill(name: string): Promise<void>;
  /** 把本地 Skill 目录（含附属文件）上传到远端项目的 .dela/skills/<name>/；
   *  目标已存在且 overwrite=false 时抛「远端已存在：…」，供渲染端二次确认。 */
  uploadSkillToRemote(
    name: string,
    remotePath: string,
    overwrite: boolean,
  ): Promise<RemoteSkillUpload>;
  listMcpServers(): Promise<McpServerView[]>;
  addMcpServer(config: {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  }): Promise<McpServerView[]>;
  /** 启停或改配置；改配置会重连。 */
  updateMcpServer(
    id: string,
    patch: {
      name?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    },
  ): Promise<McpServerView[]>;
  removeMcpServer(id: string): Promise<McpServerView[]>;
  /** 显式重连并刷新工具列表（连接失败时给模型明确的不可用边界）。 */
  refreshMcpServer(id: string): Promise<McpServerView[]>;
  listBuiltinCapabilities(): Promise<AgentCapabilityView[]>;
  /** 单个内置能力启停；返回最新清单（未知名或常驻能力抛错）。 */
  setBuiltinCapability(name: string, enabled: boolean): Promise<AgentCapabilityView[]>;
  /** 按领域批量启停（跳过常驻能力）；返回最新清单。 */
  setBuiltinDomain(domain: string, enabled: boolean): Promise<AgentCapabilityView[]>;
  /** 已保存的全部搜索服务配置；增删改在设置弹窗，选择在聊天侧。 */
  listWebSearchEntries(): Promise<WebSearchEntry[]>;
  /** 聊天侧选择器的数据：脱敏条目与当前选中（工具停用或悬空 id 视为未选）。 */
  listWebSearchOptions(): Promise<{ entries: WebSearchEntrySummary[]; selectedId: string | null }>;
  /** 搜索配置或内置工具开关变化后通知，返回退订函数。 */
  onWebSearchChanged(listener: () => void): () => void;
  /** 新建（省略 id，新建即选中）或更新一条配置；返回最新列表。 */
  saveWebSearchEntry(entry: WebSearchEntryInput): Promise<WebSearchEntry[]>;
  /** 删除一条配置；删的是选中项时自动回落到剩余第一条；返回最新列表。 */
  removeWebSearchEntry(id: string): Promise<WebSearchEntry[]>;
  /** 聊天侧选择当前使用的配置；选择即视为要用搜索，顺带启用 web_search 工具；
   *  传 null 表示关闭联网搜索。 */
  selectWebSearchEntry(id: string | null): Promise<void>;
  /** 可导入密钥的 DeepSeek 模型供应商（不含密钥）；使用中的排最前。 */
  listWebSearchKeySources(): Promise<WebSearchKeySource[]>;
  /** 读指定 DeepSeek 模型供应商的密钥给表单预填（不落库）；供应商不可用时返回 null。
   *  导入的是静态副本，不随供应商换 Key 更新。 */
  readWebSearchKey(providerId: string): Promise<string | null>;
}
