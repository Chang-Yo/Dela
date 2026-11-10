/** 未填写的限制沿用运行时默认值。 */
export interface LlmModelSettings {
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 模型可读图片（视觉输入）；文本输入固定开启，不另设字段。 */
  vision?: boolean;
  effortLevels?: string[];
  effort?: string;
}

/** LLM 提供商的脱敏视图：密钥永不返回 renderer。 */
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
  /** 自定义服务必填；内置厂商取 Pi 目录里的地址。 */
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
  /** 检测成功时端点返回的模型 id 列表，可能为空。 */
  models?: string[];
  /** 探测出的真实 API 根地址（例如裸源地址补上 /v1）；与填写值不同才出现，表单据此自动校正。 */
  baseUrl?: string;
}

/** Pi 目录里的模型：参数随目录更新，不由用户填写。 */
export interface LlmCatalogModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  vision: boolean;
  /** 空表示不支持思考；none 表示可以关闭思考。 */
  effortLevels: string[];
}

/** 可用 API Key 接入的 Pi 内置厂商。 */
export interface LlmCatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: LlmCatalogModel[];
}

export interface LlmApi {
  /** 内置厂商与模型目录：随 Pi 发布，并定期从 pi.dev 更新。 */
  catalog(): Promise<LlmCatalogProvider[]>;
  list(): Promise<LlmProviderView[]>;
  save(input: LlmSaveInput): Promise<LlmProviderView>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  verify(input: LlmVerifyInput): Promise<LlmVerifyResult>;
  /** 自定义服务按 baseUrl 检测；内置厂商按 piProvider 取目录里的模型。 */
  verifyModel(input: {
    id?: string;
    piProvider?: string | null;
    baseUrl?: string;
    apiKey?: string;
    model: string;
    settings?: LlmModelSettings;
  }): Promise<LlmVerifyResult>;
}
