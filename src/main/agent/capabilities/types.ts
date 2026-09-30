// 能力层主进程契约：skills 与 mcp 的实现经此进入执行循环（结构 §2.1 capabilities/）。
// 依赖方向：capabilities → tools/registry 的类型与 shared；不 import session/core。
import type { SkillView, McpServerView } from '../../../shared/capabilities';

/** 供 session/manager 取用后注入 context/assemble 的 Skill 索引（渐进加载：先名与描述，正文按需读取）。 */
export interface SkillIndexEntry {
  name: string;
  description: string;
}

/** OpenAI function 工具定义（与 tools/registry 的 modelToolDefinitions 同形）。 */
export interface DynamicToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** 能力层对执行循环暴露的聚合面。 */
export interface CapabilityRuntime {
  /** 已启用 Skill 的索引（无则空数组）。 */
  skillIndex(): SkillIndexEntry[];
  /** 当前已连接 MCP 服务器的工具定义（命名空间化：mcp_<server>_<tool>）。 */
  mcpToolDefinitions(): DynamicToolDefinition[];
  /** 执行 MCP 工具；非 MCP 工具名或服务器不可用时返回错误结果。 */
  executeMcpTool(
    name: string,
    input: unknown,
  ): Promise<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }>;
}

export type { SkillView, McpServerView };
