// 桌面私有的模型提供商视图：不进入 Agent 协议的 JSON Schema，也不带版本。
import { z } from 'zod';
import { providerIdSchema } from './agent';
import { defineContract } from './contract';

export interface LlmModelSettings {
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
  effortLevels?: string[];
  effort?: string;
}

export interface LlmProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  /** Pi 内置厂商的 id；null 为自定义的 OpenAI 兼容服务。 */
  piProvider: string | null;
  /** 启用只表示进入会话的模型候选；用哪个模型由会话自己决定。 */
  enabled: boolean;
}

export interface LlmSaveInput {
  id?: string;
  name: string;
  baseUrl?: string;
  /** 留空且 id 已存在时沿用已保存密钥（改地址同样不必重填）；新建时必填。 */
  apiKey?: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  piProvider?: string | null;
}

export interface LlmVerifyInput {
  /** 已保存的提供商 id；apiKey 留空时仅允许在其已保存地址检测存储密钥。 */
  id?: string;
  baseUrl: string;
  apiKey?: string;
}

export interface LlmVerifyResult {
  ok: boolean;
  message: string;
  models?: string[];
  /** 探测出的真实 API 根地址（例如裸源地址补上 /v1）；与填写值不同才出现，表单据此自动校正。 */
  baseUrl?: string;
}

export interface LlmCatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  vision: boolean;
  effortLevels: string[];
}

export interface LlmCatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: LlmCatalogModel[];
}

const providerId = providerIdSchema;

/** 输入由主进程按提供商 schema 校验；写入后用到该提供商的会话按新配置重建。 */
export const llmContract = defineContract(
  'llm',
  {
    catalog: { input: z.undefined(), output: z.custom<LlmCatalogProvider[]>() },
    list: { input: z.undefined(), output: z.custom<LlmProviderView[]>() },
    save: { input: z.custom<LlmSaveInput>(), output: z.custom<LlmProviderView>() },
    remove: { input: providerId, output: z.void() },
    setEnabled: { input: z.object({ id: providerId, enabled: z.boolean() }), output: z.void() },
    verify: {
      input: z.object({
        id: providerId.optional(),
        baseUrl: z.string(),
        apiKey: z.string().optional(),
      }),
      output: z.custom<LlmVerifyResult>(),
    },
    /** 自定义服务按 baseUrl 检测；内置厂商按 piProvider 取目录里的模型。 */
    verifyModel: {
      input: z.custom<{
        id?: string;
        piProvider?: string | null;
        baseUrl?: string;
        apiKey?: string;
        model: string;
        settings?: LlmModelSettings;
      }>(),
      output: z.custom<LlmVerifyResult>(),
    },
  },
  {
    /** ~/.dela/config.json 被 Dela 以外的工具改动后推送最新列表。 */
    list: z.custom<LlmProviderView[]>(),
  },
);
