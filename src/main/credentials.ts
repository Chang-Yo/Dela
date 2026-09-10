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
