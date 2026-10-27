import { app, safeStorage } from 'electron';
import { basename, join } from 'node:path';
import {
  copyFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface MailCredential {
  address: string;
  password: string;
}

export class CredentialDecryptionError extends Error {
  constructor(path: string, cause: unknown) {
    const label =
      (
        {
          'llm-providers.bin': '模型服务配置',
          'mail-credentials.bin': '邮箱凭据',
          'canvas-token.bin': 'Canvas 凭据',
          'shuiyuan-key.bin': '水源凭据',
        } as Record<string, string>
      )[basename(path)] ?? '凭据';
    super(`本机无法解密${label}，请在设置中重新配置。原加密文件仍保留，重新保存时会自动备份。`, {
      cause,
    });
    this.name = 'CredentialDecryptionError';
  }
}

// 加密完成后原子替换；无法解密的旧文件先备份，不因重新配置而丢失恢复机会。
function writeSealed(path: string, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  const sealed = safeStorage.encryptString(plaintext);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if (existsSync(path)) {
      try {
        safeStorage.decryptString(readFileSync(path));
      } catch {
        copyFileSync(path, `${path}.unreadable-${randomUUID()}.bak`);
      }
    }
    writeFileSync(temporary, sealed);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function readSealed(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  const sealed = readFileSync(path);
  try {
    return safeStorage.decryptString(sealed);
  } catch (cause) {
    throw new CredentialDecryptionError(path, cause);
  }
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
  modelConfigs?: Record<string, import('../shared/llm').LlmModelSettings>;
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
  if (payload === null) return { providers: [], activeId: null };
  return parseLlmConfig(payload);
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
