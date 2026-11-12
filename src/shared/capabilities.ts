// 能力层契约（MCP 与 Skills）：main 拥有连接与启停事实，renderer 只持镜像。
import type {
  AgentCapabilityView,
  McpServerInput,
  McpServerPatch,
  McpServerView,
  SkillView,
  WebSearchEntry,
  WebSearchEntryInput,
  WebSearchEntrySummary,
  WebSearchKeySource,
} from '../core/protocol/capabilities';

export type * from '../core/protocol/capabilities';

/** 上传本地 Skill 到远端项目的结果。 */
export interface RemoteSkillUpload {
  /** 远端目标目录，例如 /root/proj/.dela/skills/lint。 */
  path: string;
  /** 写入的文件数（含附属文件）。 */
  files: number;
}

export interface CapabilityApi {
  listSkills(): Promise<SkillView[]>;
  /** 启停 Skill（id 取自清单）；返回最新列表（未知 id 抛错）。 */
  setSkillEnabled(id: string, enabled: boolean): Promise<SkillView[]>;
  installSkillDependencies(name: string): Promise<SkillView[]>;
  cancelSkillInstallation(name: string): Promise<void>;
  /** 读取 SKILL.md 全文；id 必须在清单里，主进程不读清单外的路径。 */
  readSkill(id: string): Promise<string>;
  /** 在系统文件管理器中显示 SKILL.md 所在位置。 */
  revealSkill(id: string): Promise<void>;
  /** 把本地 Skill 目录（含附属文件）上传到远端项目的 .dela/skills/<name>/；
   *  目标已存在且 overwrite=false 时抛「远端已存在：…」，供渲染端二次确认。 */
  uploadSkillToRemote(
    id: string,
    remotePath: string,
    overwrite: boolean,
  ): Promise<RemoteSkillUpload>;
  listMcpServers(): Promise<McpServerView[]>;
  addMcpServer(config: McpServerInput): Promise<McpServerView[]>;
  /** 启停或改配置；改配置会重连。 */
  updateMcpServer(id: string, patch: McpServerPatch): Promise<McpServerView[]>;
  removeMcpServer(id: string): Promise<McpServerView[]>;
  /** 显式重连并刷新工具列表（连接失败时给模型明确的不可用边界）。 */
  refreshMcpServer(id: string): Promise<McpServerView[]>;
  listBuiltinCapabilities(): Promise<AgentCapabilityView[]>;
  /** 单个内置能力启停；返回最新清单（未知名或常驻能力抛错）。 */
  setBuiltinCapability(name: string, enabled: boolean): Promise<AgentCapabilityView[]>;
  /** 按领域批量启停（跳过常驻能力）；返回最新清单。 */
  setBuiltinDomain(domain: string, enabled: boolean): Promise<AgentCapabilityView[]>;
  /** 全应用同时运行的子 Agent 上限（同步与后台合计）。 */
  getSubagentLimit(): Promise<number>;
  setSubagentLimit(limit: number): Promise<number>;
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
