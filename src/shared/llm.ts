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
  presetId: string | null;
  /** 启用只表示进入会话的模型候选；用哪个模型由会话自己决定。 */
  enabled: boolean;
}

export interface LlmSaveInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** 留空且 id 已存在时沿用已保存密钥（改地址同样不必重填）；新建时必填。 */
  apiKey?: string;
  models: string[];
  modelConfigs?: Record<string, LlmModelSettings>;
  presetId?: string | null;
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

export interface LlmApi {
  list(): Promise<LlmProviderView[]>;
  save(input: LlmSaveInput): Promise<LlmProviderView>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  verify(input: LlmVerifyInput): Promise<LlmVerifyResult>;
  verifyModel(
    input: LlmVerifyInput & { model: string; settings?: LlmModelSettings },
  ): Promise<LlmVerifyResult>;
}
