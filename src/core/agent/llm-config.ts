// 模型服务存在 ~/.dela/config.json 的 providers 里，键是服务 id；magpie 连接 Dela 时会往里加自己的一项。
// id 新建后不再变（会话按它记住用哪个服务），显示名另存，可以随便改。
import { z } from 'zod';
import type { LlmModelSettings } from '../protocol/llm';
import { providerIdSchema } from '../protocol/agent';
import {
  isJsonObject,
  readConfigFile,
  sectionOf,
  uniqueKey,
  updateConfigFile,
  type JsonObject,
} from '../config-files';

/** 主进程里的模型服务配置；apiKey 不进 renderer 或 SQLite。 */
export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  piProvider: string | null;
  /** 停用的提供商不进入会话的模型候选；用它的会话保留选择，但不能发送。 */
  enabled: boolean;
}

export interface StoredLlmConfig {
  providers: StoredLlmProvider[];
}

const modelEntrySchema = z.object({
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  vision: z.boolean().optional(),
  effortLevels: z.array(z.string()).optional(),
  effort: z.string().optional(),
});

const providerEntrySchema = z.object({
  name: z.string().min(1),
  /** Pi 内置厂商的 id；不写就是 OpenAI 兼容的自定义服务。 */
  vendor: z.string().min(1).optional(),
  baseUrl: z.string(),
  apiKey: z.string(),
  enabled: z.boolean().default(true),
  models: z.record(z.string(), modelEntrySchema).default({}),
});

const PROVIDERS_KEY = 'providers';

/** 写错的那一项跳过，其余照常可用；改哪项只写哪项，所以跳过的内容也不会被覆盖。 */
export function loadLlmConfig(): StoredLlmConfig {
  const section = readConfigFile('config.json')[PROVIDERS_KEY];
  if (!isJsonObject(section)) return { providers: [] };
  return {
    providers: Object.entries(section).flatMap(([id, value]) => {
      const entry = providerEntrySchema.safeParse(value);
      if (!entry.success || !providerIdSchema.safeParse(id).success) return [];
      const { vendor, models, ...rest } = entry.data;
      return [
        {
          id,
          ...rest,
          piProvider: vendor ?? null,
          models: Object.keys(models),
          modelConfigs: models,
        },
      ];
    }),
  };
}

/** 自定义服务的 id 取域名里的品牌名：api.siliconflow.cn → siliconflow；取不出时叫 custom。 */
function brandOf(baseUrl: string): string {
  const labels = new URL(baseUrl).hostname
    .split('.')
    .filter((label) => label !== 'api' && label !== 'www');
  const brand = (labels.length > 1 ? labels.at(-2) : labels[0]) ?? '';
  return /^[a-z][a-z0-9-]{0,47}$/i.test(brand) ? brand.toLowerCase() : 'custom';
}

/** 保留这一项里 Dela 不认识的字段（magpie 或用户自己加的）。 */
function putProvider(section: JsonObject, provider: StoredLlmProvider): void {
  const previous = section[provider.id];
  const kept = isJsonObject(previous) ? { ...previous } : {};
  delete kept.vendor;
  section[provider.id] = {
    ...kept,
    name: provider.name,
    ...(provider.piProvider ? { vendor: provider.piProvider } : {}),
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    enabled: provider.enabled,
    models: Object.fromEntries(
      provider.models.map((id) => [id, provider.modelConfigs?.[id] ?? {}]),
    ),
  };
}

export function writeLlmProvider(provider: StoredLlmProvider): void {
  updateConfigFile('config.json', (config) =>
    putProvider(sectionOf(config, PROVIDERS_KEY), provider),
  );
}

export function addLlmProvider(provider: Omit<StoredLlmProvider, 'id'>): StoredLlmProvider {
  let added: StoredLlmProvider | undefined;
  updateConfigFile('config.json', (config) => {
    const section = sectionOf(config, PROVIDERS_KEY);
    const id = uniqueKey(section, provider.piProvider ?? brandOf(provider.baseUrl));
    added = { ...provider, id };
    putProvider(section, added);
  });
  return added!;
}

export function deleteLlmProvider(id: string): void {
  updateConfigFile('config.json', (config) => {
    delete sectionOf(config, PROVIDERS_KEY)[id];
  });
}
