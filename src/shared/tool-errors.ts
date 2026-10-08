// 工具执行错误的跨层契约（main 进程各业务域共用）：细分错误码由边界抛出方携带，
// agent/tools/registry 与 workspace/api 统一映射为模型/渲染侧可读结果。
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
