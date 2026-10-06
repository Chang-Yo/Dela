// 能力层契约（阶段四：MCP 与 Skills，docs/agent-workspace-plan.md §5.3）。
// 类型归 shared：main 拥有事实（连接状态、启停、发现），renderer 只持镜像。

/** 已发现的 Skill（来自工作目录 skills/ 下的 SKILL.md，agentskills.io 规范）。 */
export interface SkillView {
  /** 目录名，同时是 read_skill 工具的标识。 */
  name: string;
  /** frontmatter 的 description，进入模型侧索引。 */
  description: string;
  enabled: boolean;
  /** SKILL.md 的绝对路径（供 UI 展示来源）。 */
  path: string;
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
  /** 所属领域 id（canvas / mail / …），设置页按域分组与批量开关。 */
  domain: string;
  /** 领域显示名。 */
  domainLabel: string;
  /** 提供给模型的工具描述（UI 摘要）。 */
  description: string;
  enabled: boolean;
  /** 常驻能力：被其他工具依赖，不可关闭（UI 只读展示 + 原因）。 */
  lockedReason?: string;
}

export interface CapabilityApi {
  listSkills(): Promise<SkillView[]>;
  /** 启停 Skill；返回最新列表（未知名抛错）。 */
  setSkillEnabled(name: string, enabled: boolean): Promise<SkillView[]>;
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
  /** 内置 Agent 能力（工具）清单与启用态。 */
  listBuiltinCapabilities(): Promise<AgentCapabilityView[]>;
  /** 单个内置能力启停；返回最新清单（未知名或常驻能力抛错）。 */
  setBuiltinCapability(name: string, enabled: boolean): Promise<AgentCapabilityView[]>;
  /** 按领域批量启停（跳过常驻能力）；返回最新清单。 */
  setBuiltinDomain(domain: string, enabled: boolean): Promise<AgentCapabilityView[]>;
}
