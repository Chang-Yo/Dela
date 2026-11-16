import { hostPorts } from '../../../core/ports';

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
