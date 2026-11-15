import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { electronPorts } from '../../app/main/host-electron';
import { CredentialDecryptionError, provideHostPorts } from '../../core/ports';

const storage = vi.hoisted(() => ({ directory: '', available: true }));
vi.mock('electron', () => ({
  app: { getPath: () => storage.directory },
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString: (text: string) => Buffer.from(`test-sealed:${text}`),
    decryptString: (sealed: Buffer) => {
      const text = sealed.toString();
      if (!text.startsWith('test-sealed:')) throw new Error('ciphertext cannot be decrypted');
      return text.slice('test-sealed:'.length);
    },
  },
}));

beforeEach(() => {
  storage.directory = mkdtempSync(join(tmpdir(), 'dela-credentials-test-'));
  storage.available = true;
  provideHostPorts(electronPorts);
});
afterEach(() => {
  for (const file of readdirSync(storage.directory)) unlinkSync(join(storage.directory, file));
  rmdirSync(storage.directory);
});

describe('sealed credential recovery', () => {
  it('retains readable credentials across saves', () => {
    electronPorts.secrets.write('test-secret', 'first-test-token');
    expect(electronPorts.secrets.read('test-secret')).toBe('first-test-token');
    electronPorts.secrets.write('test-secret', 'second-test-token');
    expect(electronPorts.secrets.read('test-secret')).toBe('second-test-token');
    expect(readdirSync(storage.directory)).toEqual(['test-secret.bin']);
  });

  it('preserves an unreadable file and gives an actionable error without leaking its content', () => {
    const path = join(storage.directory, 'test-secret.bin');
    writeFileSync(path, 'unreadable-test-ciphertext');
    expect(() => electronPorts.secrets.read('test-secret')).toThrow(CredentialDecryptionError);
    expect(() => electronPorts.secrets.read('test-secret')).toThrow('请在设置中重新配置');
    expect(readFileSync(path).toString()).toBe('unreadable-test-ciphertext');
  });

  it('backs up unreadable ciphertext before replacing it, leaving no temporary files', () => {
    writeFileSync(join(storage.directory, 'test-secret.bin'), 'old-test-ciphertext');
    electronPorts.secrets.write('test-secret', 'new-test-token');
    expect(electronPorts.secrets.read('test-secret')).toBe('new-test-token');
    const backups = readdirSync(storage.directory).filter((name) => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(storage.directory, backups[0]!)).toString()).toBe(
      'old-test-ciphertext',
    );
    expect(readdirSync(storage.directory).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('does not replace or back up files when encryption is unavailable', () => {
    const path = join(storage.directory, 'test-secret.bin');
    writeFileSync(path, 'old-test-ciphertext');
    storage.available = false;
    expect(() => electronPorts.secrets.write('test-secret', 'new-test-token')).toThrow(
      '当前系统不支持凭据加密存储',
    );
    expect(existsSync(path)).toBe(true);
    expect(readdirSync(storage.directory)).toEqual(['test-secret.bin']);
  });
});
