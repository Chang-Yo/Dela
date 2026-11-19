/** 模型设置的默认值与推理档位；内置厂商的默认参数来自 Pi 目录，用户可以覆盖上下文与最大输出。 */
import type { LlmModelSettings } from './llm';

export const LLM_MODEL_LIMIT = 64;
export const LLM_DEFAULT_CONTEXT_WINDOW = 256000;
export const LLM_DEFAULT_OUTPUT_TOKENS = 32000;

/** 未填写的一项按 defaults 计：自定义服务用上面的默认值，内置厂商用目录值。 */
export function llmLimitError(
  settings: Pick<LlmModelSettings, 'contextWindow' | 'maxOutputTokens'>,
  defaults: { contextWindow: number; maxOutputTokens: number },
): string | null {
  if (settings.contextWindow === undefined && settings.maxOutputTokens === undefined) return null;
  const context = settings.contextWindow ?? defaults.contextWindow;
  const output = settings.maxOutputTokens ?? defaults.maxOutputTokens;
  return output < context ? null : `最大输出（${output}）必须小于上下文窗口（${context}）`;
}

export function llmModelSettings(
  provider: { modelConfigs?: Record<string, LlmModelSettings> },
  model: string,
): LlmModelSettings & { effortLevels: string[] } {
  const settings = provider.modelConfigs?.[model] ?? {};
  const effortLevels = settings.effortLevels ?? [];
  const preferred = settings.effort;
  const effort = preferred && effortLevels.includes(preferred) ? preferred : effortLevels[0];
  return { ...settings, effortLevels, effort };
}

export const reasoningEffortLevels = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
