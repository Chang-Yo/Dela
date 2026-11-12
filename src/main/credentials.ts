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
