import type {
  LlmCatalogProvider,
  LlmModelSettings,
  LlmProviderView,
  LlmSaveInput,
  LlmVerifyInput,
  LlmVerifyResult,
} from '../core/protocol/llm';

export type * from '../core/protocol/llm';

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
