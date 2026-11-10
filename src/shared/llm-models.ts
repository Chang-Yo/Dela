/** 模型设置的默认值与推理档位；内置厂商的模型参数来自 Pi 目录，这里只服务自定义服务。 */
import type { LlmModelSettings } from './llm';

export const LLM_MODEL_LIMIT = 64;
export const LLM_DEFAULT_CONTEXT_WINDOW = 256000;
export const LLM_DEFAULT_OUTPUT_TOKENS = 32000;

/** 推理档位与当前选择按模型保存。 */
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

/** 推理强度档位：跨提供商的超集，按强度递增排序。 */
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
