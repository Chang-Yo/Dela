/** 未填写的限制沿用运行时默认值；缺省档位兼容旧提供商级配置。 */
export interface LlmModelSettings {
  contextWindow?: number;
  maxOutputTokens?: number;
  effortLevels?: string[];
  effort?: string;
}

/** LLM 提供商的脱敏视图：密钥永不返回 renderer。 */
export interface LlmProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  model: string;
  modelConfigs?: Record<string, LlmModelSettings>;
  /** 当前模型暴露给 composer 的档位子集；空数组表示未开启。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 null。 */
  effort: string | null;
  presetId: string | null;
  active: boolean;
}

export interface LlmSaveInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** 留空且 id 已存在、地址未变时保留已保存密钥；新建或更改地址时必填。 */
  apiKey?: string;
  models: string[];
  model: string;
  modelConfigs?: Record<string, LlmModelSettings>;
  /** 旧提供商级档位；逐模型 modelConfigs 的配置优先。 */
  effortLevels?: string[];
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
}

export interface LlmApi {
  list(): Promise<LlmProviderView[]>;
  save(input: LlmSaveInput): Promise<LlmProviderView>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  /** 为当前使用中的提供商切换模型。 */
  setModel(model: string): Promise<void>;
  /** 为当前使用中的提供商切换推理强度档位（须在其已开启的档位列表内）。 */
  setEffort(level: string): Promise<void>;
  verify(input: LlmVerifyInput): Promise<LlmVerifyResult>;
  verifyModel(
    input: LlmVerifyInput & { model: string; settings?: LlmModelSettings },
  ): Promise<LlmVerifyResult>;
}
