/** LLM 提供商预设：只承载默认值，不含密钥；密钥只存在主进程的配置实例里。 */
import type { LlmModelSettings } from './llm';

export const LLM_MODEL_LIMIT = 64;
export const LLM_DEFAULT_CONTEXT_WINDOW = 256000;
export const LLM_DEFAULT_OUTPUT_TOKENS = 128000;

/** 推理档位与当前选择按模型保存。 */
export function llmModelSettings(
  provider: {
    model: string;
    modelConfigs?: Record<string, LlmModelSettings>;
  },
  model = provider.model,
): LlmModelSettings & { effortLevels: string[] } {
  const settings = provider.modelConfigs?.[model] ?? {};
  const effortLevels = settings.effortLevels ?? [];
  const preferred = settings.effort;
  const effort = preferred && effortLevels.includes(preferred) ? preferred : effortLevels[0];
  return { ...settings, effortLevels, effort };
}
export interface LlmProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 新建配置的初始模型列表，第一个为默认模型；真实可用模型以「检测」返回为准。 */
  models: string[];
  /** 获取 API Key 的控制台地址；自定义预设没有。 */
  keyUrl?: string;
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

export const llmProviderPresets: readonly LlmProviderPreset[] = [
  {
    id: 'zhiyuan',
    name: '致远一号',
    baseUrl: 'https://models.sjtu.edu.cn/api/v1',
    models: ['qwen', 'deepseek-chat', 'deepseek-reasoner', 'minimax'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    keyUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'zhipu-coding',
    name: '智谱 Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: ['glm-5.2', 'glm-4.7'],
    keyUrl: 'https://bigmodel.cn/coding-plan/personal/overview',
  },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] },
];

export function findLlmPreset(id: string | null | undefined): LlmProviderPreset | undefined {
  return llmProviderPresets.find((preset) => preset.id === id);
}
