import { z } from 'zod';
import type { TodoItem } from '../../../shared/api';

export const uuid = z.string().uuid();
export const query = z.string().max(500).default('');
export const offset = z.number().int().min(0).default(0);
export const limit = z.number().int().min(1).max(100).default(30);
export const name = z.string().trim().min(1).max(200);

export function page<T>(items: T[], start: number, count: number) {
  return {
    items: items.slice(start, start + count),
    total: items.length,
    nextOffset: start + count < items.length ? start + count : null,
  };
}

// 作业描述 HTML 体积大且面向渲染，不进入模型上下文；需要正文时经 readCanvasSource 读取。
export const slimTodo = ({
  description: _omit,
  ...item
}: TodoItem): Omit<TodoItem, 'description'> => item;

export function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  execute: (input: z.output<T>, context: ToolContext) => unknown,
) {
  return {
    description,
    schema,
    execute: (input: unknown, context: ToolContext = {}) => execute(schema.parse(input), context),
  };
}

export interface ToolContext {
  cwd?: string;
  signal?: AbortSignal;
  onUpdate?: (output: unknown) => void;
}

/** 工具契约：description + zod schema + execute；registry 统一做校验与错误映射。
 *  放 shared 而非 registry：领域 index 经 satisfies 引用此类型，若放 registry，
 *  领域 index → registry → 领域 index 会构成（type-only）导入环。 */
export type AgentTool = ReturnType<typeof tool>;

export function match(value: string, keyword: string) {
  return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

// —— 统一工具契约（docs/refactor/tools-inventory.md §8，decisions-phase1 裁决）——

// 错误码契约下沉 shared/tool-errors（workspace/api 等业务目录也用它）；此处 re-export
// 维持领域工具的 '../shared' import 路径不变。
export { ToolError, toolError } from '../../../shared/tool-errors';

/** cached=本地缓存查询；realtime=当次联网（水源、fetch_page、按需拉取的邮件正文）。 */
export function freshness(kind: 'cached' | 'realtime', syncedAt?: string | null) {
  return { kind, ...(syncedAt ? { syncedAt } : {}) };
}

/** scope 描述数据窗口（如 cached_titles、cached_assignments）；complete=false 时 warnings 说明缺口。 */
export function coverage(scope: string, complete: boolean, warnings?: string[]) {
  return { scope, complete, ...(warnings?.length ? { warnings } : {}) };
}

/** 远端 cursor 分页（水源 moreUrl 等）：nextCursor 为不透明字符串原样回传，不伪造 total。 */
export function cursorPage<T>(items: T[], nextCursor: string | null) {
  return { items, nextCursor };
}
