// 能力层组装（结构 §2.3）：skills 与 mcp 聚合——Skill 索引经 getter 供 session/manager
// 取用（再注入 context/assemble），MCP 工具并集与路由经 setMcpRouting 注入 tools/registry。
// 无环证明：依赖方向 capabilities → tools 单向——mcp.ts 取 agentTools 键名做命名空间
// 冲突检测、本模块 setMcpRouting 引 registry，均指向 tools；tools 侧（registry/领域
// index/shared）不 import capabilities，原 registry → capabilities 的反向边已由注入
// 消除，领域 index 的 AgentTool 类型下沉到 tools/shared。
import { setMcpRouting } from '../tools/registry';
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
setMcpRouting({ mcpToolDefinitions, executeMcpTool });
