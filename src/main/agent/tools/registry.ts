import { z } from 'zod';
import { agentTools } from './index';
import { ToolError } from './shared';

// 旧会话上下文里的旧工具名 → 新名（阶段二重设计改名，decisions-phase1 裁决 9）。
// 一个发布周期后移除。
const legacyAliases: Record<string, string> = {
  find_courses: 'list_canvas_courses',
  sync_sources: 'refresh_canvas_courses',
  search_sources: 'search_canvas_sources',
  search_workspace: 'list_workspace_entries',
  link_source: 'link_canvas_source',
};

function resolveToolName(name: string) {
  return legacyAliases[name] ?? name;
}

// MCP 工具并集与路由经注入获得（结构 §2.3：capabilities → tools 单向）。
// 本模块若静态 import capabilities 会与 mcp.ts 的 agentTools 取用成环。
export interface McpRouting {
  mcpToolDefinitions(): { type: 'function'; function: { name: string; description: string; parameters?: unknown } }[];
  executeMcpTool(name: string, input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
let mcpRouting: McpRouting | null = null;
export function setMcpRouting(routing: McpRouting): void {
  mcpRouting = routing;
}

export function modelToolDefinitions() {
  const definitions = Object.entries(agentTools).map(([name, tool]) => ({
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

export async function executeAgentTool(name: string, input: unknown) {
  // MCP 工具按命名空间前缀转给能力层路由回对应服务器连接。
  if (name.startsWith('mcp_')) {
    if (!mcpRouting)
      return { ok: false as const, error: { code: 'NOT_CONFIGURED', message: 'MCP 能力不可用' } };
    return mcpRouting.executeMcpTool(name, input);
  }
  const resolved = resolveToolName(name);
  if (!Object.hasOwn(agentTools, resolved))
    return { ok: false, error: { code: 'UNKNOWN_TOOL', message: '工具不存在' } };
  try {
    const result = await agentTools[resolved as keyof typeof agentTools].execute(input);
    return {
      ok: true as const,
      result: resolved === name ? result : { ...asRecord(result), renamedFrom: name },
    };
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

function asRecord(value: unknown) {
  return value !== null && typeof value === 'object' ? (value as object) : { value };
}
