import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { llmProviderPresets } from '../shared/llm-presets';

export interface MailCredential {
  address: string;
  password: string;
}

function credentialPath(): string {
  return join(app.getPath('userData'), 'mail-credentials.bin');
}

export function saveMailCredentials(credential: MailCredential): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持凭据加密存储');
  }
  const sealed = safeStorage.encryptString(JSON.stringify(credential));
  writeFileSync(credentialPath(), sealed);
}

export function loadMailCredentials(): MailCredential | null {
  const path = credentialPath();
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持凭据解密');
  }
  const sealed = readFileSync(path);
  const payload = safeStorage.decryptString(sealed);
  const parsed = JSON.parse(payload) as Partial<MailCredential>;
  if (typeof parsed.address !== 'string' || typeof parsed.password !== 'string') {
    return null;
  }
  return { address: parsed.address, password: parsed.password };
}

export function clearMailCredentials(): void {
  const path = credentialPath();
  if (existsSync(path)) unlinkSync(path);
}

export function saveCanvasToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  writeFileSync(
    join(app.getPath('userData'), 'canvas-token.bin'),
    safeStorage.encryptString(token),
  );
}

export function loadCanvasToken(): string | null {
  const path = join(app.getPath('userData'), 'canvas-token.bin');
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  return safeStorage.decryptString(readFileSync(path));
}

export function clearCanvasToken(): void {
  const path = join(app.getPath('userData'), 'canvas-token.bin');
  if (existsSync(path)) unlinkSync(path);
}

/** 主进程持久化的 LLM 提供商配置实例；apiKey 只存在这里，不进 renderer 或 SQLite。 */
export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  model: string;
  presetId: string | null;
}

export interface StoredLlmConfig {
  providers: StoredLlmProvider[];
  activeId: string | null;
}

function llmConfigPath(): string {
  return join(app.getPath('userData'), 'llm-providers.bin');
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
    typeof provider.model === 'string'
  );
}

export function saveLlmConfig(config: StoredLlmConfig): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  writeFileSync(llmConfigPath(), safeStorage.encryptString(JSON.stringify(config)));
}

export function loadLlmConfig(): StoredLlmConfig {
  const path = llmConfigPath();
  if (!existsSync(path)) return migrateLegacyModelCredential();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  return parseLlmConfig(safeStorage.decryptString(readFileSync(path)));
}

function parseLlmConfig(payload: string): StoredLlmConfig {
  const parsed = JSON.parse(payload) as Partial<StoredLlmConfig>;
  const providers = Array.isArray(parsed.providers) ? parsed.providers.filter(validProvider) : [];
  return {
    providers: providers.map((provider) => ({
      ...provider,
      presetId: typeof provider.presetId === 'string' ? provider.presetId : null,
    })),
    activeId:
      typeof parsed.activeId === 'string' && providers.some(({ id }) => id === parsed.activeId)
        ? parsed.activeId
        : null,
  };
}

/** 旧版单凭据（致远一号 key+model）迁移为多提供商配置；写入成功后删除旧文件。 */
function migrateLegacyModelCredential(): StoredLlmConfig {
  const legacyPath = join(app.getPath('userData'), 'model-credential.bin');
  if (!existsSync(legacyPath)) return { providers: [], activeId: null };
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  const parsed = JSON.parse(safeStorage.decryptString(readFileSync(legacyPath))) as {
    key?: unknown;
    model?: unknown;
  };
  if (typeof parsed.key !== 'string' || !parsed.key) return { providers: [], activeId: null };
  const zhiyuan = llmProviderPresets[0]!;
  const config: StoredLlmConfig = {
    providers: [
      {
        id: randomUUID(),
        name: zhiyuan.name,
        baseUrl: zhiyuan.baseUrl,
        apiKey: parsed.key,
        models: zhiyuan.models,
        model:
          typeof parsed.model === 'string' && zhiyuan.models.includes(parsed.model)
            ? parsed.model
            : zhiyuan.models[0]!,
        presetId: zhiyuan.id,
      },
    ],
    activeId: null,
  };
  config.activeId = config.providers[0]!.id;
  saveLlmConfig(config);
  unlinkSync(legacyPath);
  return config;
}
