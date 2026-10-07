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

export type { SkillView, McpServerView };
