import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

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

export function saveModelCredential(key: string, model: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据加密存储');
  writeFileSync(
    join(app.getPath('userData'), 'model-credential.bin'),
    safeStorage.encryptString(JSON.stringify({ key, model })),
  );
}

export function loadModelCredential(): { key: string; model: string } | null {
  const path = join(app.getPath('userData'), 'model-credential.bin');
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持凭据解密');
  const parsed = JSON.parse(safeStorage.decryptString(readFileSync(path))) as {
    key?: unknown;
    model?: unknown;
  };
  return typeof parsed.key === 'string' && typeof parsed.model === 'string'
    ? { key: parsed.key, model: parsed.model }
    : null;
}
