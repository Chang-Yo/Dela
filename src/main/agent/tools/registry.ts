import { z } from 'zod';
import { agentTools, toolDomains } from './index';
import { isToolDisabled, readDisabledTools } from './disabled';
import { ToolError, type ToolContext } from './shared';

// MCP 工具并集与路由经注入获得（结构 §2.3：capabilities → tools 单向）。
// 本模块若静态 import capabilities 会与 mcp.ts 的 agentTools 取用成环。
export interface McpRouting {
  mcpToolDefinitions(): {
    type: 'function';
    function: { name: string; description: string; parameters?: unknown };
  }[];
  executeMcpTool(
    name: string,
    input: unknown,
  ): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
let mcpRouting: McpRouting | null = null;
export function setMcpRouting(routing: McpRouting): void {
  mcpRouting = routing;
}

export function modelToolDefinitions() {
  // 用户在设置 › 内置能力中关闭的工具不下发给模型（本轮 Run 即时生效，无启动期缓存）。
  const disabled = readDisabledTools();
  const definitions = Object.entries(agentTools)
    .filter(([name]) => !disabled.has(name))
    .map(([name, tool]) => ({
      type: 'function' as const,
      function: {
        name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema, { io: 'input' }),
      },
    }));
  // MCP 动态工具（mcp_<server>_<tool>）并入集合（阶段四 §5.3）；参数透传服务器声明的
  // JSON Schema，缺省按空对象参数处理（归一到与内置工具相同的定义形状）。
  const dynamic = mcpRouting?.mcpToolDefinitions() ?? [];
  type BuiltinDefinition = (typeof definitions)[number];
  return [
    ...definitions,
    ...dynamic.map((definition): BuiltinDefinition => ({
      type: 'function',
      function: {
        name: definition.function.name,
        description: definition.function.description,
        parameters: (definition.function.parameters ?? {
          type: 'object',
          properties: {},
        }) as BuiltinDefinition['function']['parameters'],
      },
    })),
  ];
}

/** 内置能力清单（设置 › 内置能力）：工具名、描述与所属领域，按 toolDomains 声明顺序返回。 */
export function listBuiltinTools(): Array<{ name: string; description: string; domain: string }> {
  return toolDomains.flatMap((domain) =>
    Object.entries(domain.tools).map(([name, tool]) => ({
      name,
      description: tool.description,
      domain: domain.id,
    })),
  );
}

export async function executeAgentTool(name: string, input: unknown, context: ToolContext = {}) {
  // MCP 工具按命名空间前缀转给能力层路由回对应服务器连接。
  if (name.startsWith('mcp_')) {
    if (!mcpRouting)
      return { ok: false as const, error: { code: 'NOT_CONFIGURED', message: 'MCP 能力不可用' } };
    return mcpRouting.executeMcpTool(name, input);
  }
  if (!Object.hasOwn(agentTools, name))
    return { ok: false, error: { code: 'UNKNOWN_TOOL', message: '工具不存在' } };
  // 运行中被关闭的能力仍可能按旧定义被模型调用（MCP 同款边界），用可区分的错误码
  // 而不是 UNKNOWN_TOOL，让模型知道这是用户的开关而不是它用错了名字。
  if (isToolDisabled(name))
    return {
      ok: false,
      error: { code: 'DISABLED', message: '该能力已被用户在设置 › 内置能力中关闭，请不要重试' },
    };
  try {
    const result = await agentTools[name as keyof typeof agentTools].execute(input, context);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        code:
          error instanceof z.ZodError
            ? 'INVALID_INPUT'
            : error instanceof ToolError
              ? error.code
              : 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : '操作失败',
      },
    };
  }
}
