import type { LlmModelSettings } from '../../core/protocol/llm';
import { hostPorts } from '../host';

/** 主进程持久化的 LLM 提供商配置实例；apiKey 只存在这里，不进 renderer 或 SQLite。 */
export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  /** Pi 内置厂商的 id；null 为自定义的 OpenAI 兼容服务。 */
  piProvider: string | null;
  /** 停用的提供商不进入会话的模型候选；用它的会话保留选择，但不能发送。 */
  enabled: boolean;
}

export interface StoredLlmConfig {
  providers: StoredLlmProvider[];
}

function validProvider(value: unknown): value is StoredLlmProvider {
  if (typeof value !== 'object' || value === null) return false;
  const provider = value as Partial<StoredLlmProvider>;
  return (
    typeof provider.id === 'string' &&
    typeof provider.name === 'string' &&
    typeof provider.baseUrl === 'string' &&
    typeof provider.apiKey === 'string' &&
    Array.isArray(provider.models) &&
    provider.models.every((model) => typeof model === 'string') &&
    typeof provider.enabled === 'boolean'
  );
}

export function saveLlmConfig(config: StoredLlmConfig): void {
  hostPorts().secrets.write('llm-providers', JSON.stringify(config));
}

export function loadLlmConfig(): StoredLlmConfig {
  const payload = hostPorts().secrets.read('llm-providers');
  if (payload === null) return { providers: [] };
  return parseLlmConfig(payload);
}

function parseLlmConfig(payload: string): StoredLlmConfig {
  const parsed = JSON.parse(payload) as Partial<StoredLlmConfig>;
  const providers = Array.isArray(parsed.providers) ? parsed.providers.filter(validProvider) : [];
  return {
    providers: providers.map((provider) => ({
      ...provider,
      piProvider: typeof provider.piProvider === 'string' ? provider.piProvider : null,
    })),
  };
}
