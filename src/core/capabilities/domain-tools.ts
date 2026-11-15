import { z } from 'zod';

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

export function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  execute: (input: z.output<T>) => unknown,
) {
  return { description, schema, execute: (input: unknown) => execute(schema.parse(input)) };
}

/** dela 命令契约：description + zod schema + execute（commands.ts 经命令桥调用）。 */
export type AgentTool = ReturnType<typeof tool>;

export function match(value: string, keyword: string) {
  return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

/** 工具执行错误的跨层契约：细分错误码由边界抛出方携带，统一映射为模型与渲染侧可读的结果。 */
export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONFIGURED'
  | 'AUTH_EXPIRED'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_ERROR'
  | 'OPERATION_FAILED';

export class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function toolError(code: ToolErrorCode, message: string): ToolError {
  return new ToolError(code, message);
}

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
