import { z } from 'zod';
import { agentTools } from './index';
import type { tool } from './shared';

/** 工具契约：description + zod schema + execute；registry 统一做校验与错误映射。 */
export type AgentTool = ReturnType<typeof tool>;

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
  if (!Object.hasOwn(agentTools, name))
    return { ok: false, error: { code: 'UNKNOWN_TOOL', message: '工具不存在' } };
  try {
    const result = await agentTools[name as keyof typeof agentTools].execute(input);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof z.ZodError ? 'INVALID_INPUT' : 'OPERATION_FAILED',
        message: error instanceof Error ? error.message : '操作失败',
      },
    };
  }
}
