import { hostPorts } from '../core/ports';

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
