/**
 * 上下文预算与 token 估算（agent-workspace-plan.md §6.1「按预算触发」；decisions-phase1.md 批次 2B）。
 * 窗口大小当前为保守常量，后续接 provider 配置后由调用方传入；未知窗口不按模型名猜测。
 */

// 未知提供商的保守上下文窗口（与 core/pi.ts 的 CONSERVATIVE_CONTEXT_WINDOW 口径一致）。
export const CONTEXT_WINDOW_FALLBACK = 32768;
// 为模型输出预留的空间（对齐 core/pi.ts MAX_OUTPUT_TOKENS 起步档的量级考量，取保守 8192）。
export const OUTPUT_RESERVE_TOKENS = 8192;
// 运行内工具交互余量：多轮工具调用会在请求之间持续追加消息，预算需为其留出空间。
export const TOOL_MARGIN_TOKENS = 4096;
// 触发阈值：估算输入 ≥（窗口−预留）× 0.7 时压缩较早历史（decisions-phase1.md 批次 2B）。
export const COMPACT_TRIGGER_RATIO = 0.7;
// 摘要占位预留：压缩后摘要以 system 前置块进入上下文，为它预留的 token 上限
//（compaction 请求的 max_tokens 上限小于该值，保证摘要永远放得进预留）。
export const SUMMARY_RESERVE_TOKENS = 2048;
// 图片固定估算：不依赖图片尺寸做精确计算，按保守值计入（计划 §6.1 媒体计入预算）。
export const IMAGE_TOKEN_EST = 1000;

// CJK 字符（含假名、汉字兼容区与 CJK 标点）：按 1 token/字估算；其余按 4 字符/token。
const CJK_PATTERN = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/** token 估算启发式：CJK 1 token/字，其他 4 字符/token；空串为 0。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_PATTERN)?.length ?? 0;
  const other = text.length - cjk;
  return cjk + Math.ceil(other / 4);
}

export interface ContextBudget {
  /** 保守上下文窗口（token）。 */
  window: number;
  /** 输出预留 + 工具交互余量（token）。 */
  reserve: number;
  /** 输入预算 = 窗口 − 预留（token）。 */
  budget: number;
  /** 压缩触发阈值 = 预算 × 0.7（token）。 */
  compactThreshold: number;
}

/** 当前生效的上下文预算口径；窗口来源后续接 provider 配置。 */
export function contextBudget(): ContextBudget {
  const window = CONTEXT_WINDOW_FALLBACK;
  const reserve = OUTPUT_RESERVE_TOKENS + TOOL_MARGIN_TOKENS;
  const budget = window - reserve;
  return { window, reserve, budget, compactThreshold: Math.floor(budget * COMPACT_TRIGGER_RATIO) };
}

/** 估算输入 ≥（窗口−预留）× 0.7 时应压缩较早历史。 */
export function shouldCompact(estimate: number): boolean {
  return estimate >= contextBudget().compactThreshold;
}
