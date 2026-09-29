/** LLM 提供商的脱敏视图：密钥永不返回 renderer。 */
export interface LlmProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  model: string;
  /** 开启推理强度后暴露给 composer 的档位子集；空数组表示未开启。 */
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
  /** 留空且 id 已存在时保留已保存密钥；新建时必填。 */
  apiKey?: string;
  models: string[];
  model: string;
  /** 开启推理强度时暴露的档位（多选）；空数组或缺省表示关闭。 */
  effortLevels?: string[];
  presetId?: string | null;
}

export interface LlmVerifyInput {
  /** 已保存的提供商 id；apiKey 留空时取其存储密钥。 */
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
}
