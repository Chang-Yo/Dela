import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { llmProviderPresets } from '../shared/llm-presets';

export interface MailCredential {
  address: string;
  password: string;
}

// 下方各组凭据文件共用的密封读写样板；错误文案是既有契约。
function writeSealed(path: string, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  writeFileSync(path, safeStorage.encryptString(plaintext));
}

function readSealed(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  return safeStorage.decryptString(readFileSync(path));
}

function removeSealed(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function credentialPath(): string {
  return join(app.getPath('userData'), 'mail-credentials.bin');
}

export function saveMailCredentials(credential: MailCredential): void {
  writeSealed(credentialPath(), JSON.stringify(credential));
}

export function loadMailCredentials(): MailCredential | null {
  const payload = readSealed(credentialPath());
  if (payload === null) return null;
  const parsed = JSON.parse(payload) as Partial<MailCredential>;
  if (typeof parsed.address !== 'string' || typeof parsed.password !== 'string') {
    return null;
  }
  return { address: parsed.address, password: parsed.password };
}

export function clearMailCredentials(): void {
  removeSealed(credentialPath());
}

function canvasTokenPath(): string {
  return join(app.getPath('userData'), 'canvas-token.bin');
}

export function saveCanvasToken(token: string): void {
  writeSealed(canvasTokenPath(), token);
}

export function loadCanvasToken(): string | null {
  return readSealed(canvasTokenPath());
}

export function clearCanvasToken(): void {
  removeSealed(canvasTokenPath());
}

/** 水源 User API Key 的本地形态；key 只存在主进程，不进 renderer 或数据库。 */
export interface ShuiyuanCredential {
  key: string;
  clientId: string;
  username: string;
  boundAt: string;
}

function shuiyuanPath(): string {
  return join(app.getPath('userData'), 'shuiyuan-key.bin');
}

export function saveShuiyuanCredential(credential: ShuiyuanCredential): void {
  writeSealed(shuiyuanPath(), JSON.stringify(credential));
}

export function loadShuiyuanCredential(): ShuiyuanCredential | null {
  const payload = readSealed(shuiyuanPath());
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
  removeSealed(shuiyuanPath());
}

/** 主进程持久化的 LLM 提供商配置实例；apiKey 只存在这里，不进 renderer 或 SQLite。 */
export interface StoredLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  model: string;
  /** 开启推理强度后暴露的档位子集；空数组表示未开启。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 undefined。 */
  effort?: string;
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
  writeSealed(llmConfigPath(), JSON.stringify(config));
}

export function loadLlmConfig(): StoredLlmConfig {
  const payload = readSealed(llmConfigPath());
  if (payload === null) return migrateLegacyModelCredential();
  return parseLlmConfig(payload);
}

function parseLlmConfig(payload: string): StoredLlmConfig {
  const parsed = JSON.parse(payload) as Partial<StoredLlmConfig>;
  const providers = Array.isArray(parsed.providers) ? parsed.providers.filter(validProvider) : [];
  return {
    providers: providers.map((provider) => ({
      ...provider,
      presetId: typeof provider.presetId === 'string' ? provider.presetId : null,
      effortLevels: Array.isArray(provider.effortLevels)
        ? provider.effortLevels.filter((level): level is string => typeof level === 'string')
        : [],
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
  const payload = readSealed(legacyPath);
  if (payload === null) return { providers: [], activeId: null };
  const parsed = JSON.parse(payload) as {
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
        effortLevels: [],
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
