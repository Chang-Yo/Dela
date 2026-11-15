import { join } from 'node:path';
import { getDatabase } from './database';
import { hostPorts } from '../core/ports';

export function storageDirectory() {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='directory'")
    .get() as { value: string } | undefined;
  return row?.value ?? join(hostPorts().paths.documents(), 'Dela');
}
