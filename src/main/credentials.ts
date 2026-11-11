import { hostPorts } from './host';

export interface MailCredential {
  address: string;
  password: string;
}

export function saveMailCredentials(credential: MailCredential): void {
  hostPorts().secrets.write('mail-credentials', JSON.stringify(credential));
}

export function loadMailCredentials(): MailCredential | null {
  const payload = hostPorts().secrets.read('mail-credentials');
  if (payload === null) return null;
  const parsed = JSON.parse(payload) as Partial<MailCredential>;
  if (typeof parsed.address !== 'string' || typeof parsed.password !== 'string') {
    return null;
  }
  return { address: parsed.address, password: parsed.password };
}

export function clearMailCredentials(): void {
  hostPorts().secrets.remove('mail-credentials');
}

export function saveCanvasToken(token: string): void {
  hostPorts().secrets.write('canvas-token', token);
}

export function loadCanvasToken(): string | null {
  return hostPorts().secrets.read('canvas-token');
}

export function clearCanvasToken(): void {
  hostPorts().secrets.remove('canvas-token');
}

/** 水源 User API Key 的本地形态；key 只存在主进程，不进 renderer 或数据库。 */
export interface ShuiyuanCredential {
  key: string;
  clientId: string;
  username: string;
  boundAt: string;
}

export function saveShuiyuanCredential(credential: ShuiyuanCredential): void {
  hostPorts().secrets.write('shuiyuan-key', JSON.stringify(credential));
}

export function loadShuiyuanCredential(): ShuiyuanCredential | null {
  const payload = hostPorts().secrets.read('shuiyuan-key');
  if (payload === null) return null;
  const parsed = JSON.parse(payload) as Partial<ShuiyuanCredential>;
  if (
    typeof parsed.key !== 'string' ||
    typeof parsed.clientId !== 'string' ||
    typeof parsed.username !== 'string' ||
    typeof parsed.boundAt !== 'string'
  ) {
    return null;
  }
  return {
    key: parsed.key,
    clientId: parsed.clientId,
    username: parsed.username,
    boundAt: parsed.boundAt,
  };
}

export function clearShuiyuanCredential(): void {
  hostPorts().secrets.remove('shuiyuan-key');
}

/** 整份 MCP 配置加密保存：env、请求头与参数里都可能有密钥。结构由 mcp.ts 校验。 */
export function saveMcpServers(configs: unknown[]): void {
  hostPorts().secrets.write('mcp-servers', JSON.stringify(configs));
}

export function loadMcpServers(): unknown {
  const payload = hostPorts().secrets.read('mcp-servers');
  return payload === null ? [] : JSON.parse(payload);
}

/** 主进程持久化的 LLM 提供商配置实例；apiKey 只存在这里，不进 renderer 或 SQLite。 */
export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelConfigs?: Record<string, import('../shared/llm').LlmModelSettings>;
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
