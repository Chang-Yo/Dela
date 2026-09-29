// 能力层组装（结构 §2.3）：skills 与 mcp 聚合成 CapabilityRuntime，经 getter 供
// tools/registry（MCP 工具并集与路由）与 context/assemble（Skill 索引段）消费。
// 无环证明：本模块与 {skills,skill-tools,mcp}.ts 均不 import session/core/registry；
// mcp.ts 仅取 tools 的 agentTools 键名做命名空间冲突检测，tools/common/skill-read.ts
// 仅 import capabilities/skill-tools（不回到本模块），两个方向在文件级均不成环。
import { mcpToolDefinitions, executeMcpTool } from './mcp';
import { skillIndex } from './skills';
import type { CapabilityRuntime } from './types';

let runtime: CapabilityRuntime | null = null;

export function setCapabilityRuntime(next: CapabilityRuntime): void {
  runtime = next;
}

export function getCapabilityRuntime(): CapabilityRuntime | null {
  return runtime;
}

setCapabilityRuntime({ skillIndex, mcpToolDefinitions, executeMcpTool });
