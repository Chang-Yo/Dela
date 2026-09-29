import { z } from 'zod';
import { agentTools } from './index';
import { ToolError, type tool } from './shared';

/** 工具契约：description + zod schema + execute；registry 统一做校验与错误映射。 */
export type AgentTool = ReturnType<typeof tool>;

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

export function modelToolDefinitions() {
  return Object.entries(agentTools).map(([name, tool]) => ({
    type: 'function' as const,
    function: {
      name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema, { io: 'input' }),
    },
  }));
}

export async function executeAgentTool(name: string, input: unknown) {
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
