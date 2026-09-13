import { app } from 'electron';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getDatabase } from './database';

export function storageDirectory() {
  const row = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='directory'")
    .get() as { value: string } | undefined;
  return row?.value ?? join(app.getPath('documents'), 'Dela');
}

// A single path component, including Windows device names and trailing dots/spaces.
export function diskName(name: string) {
  let value = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!value) value = '未命名';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value;
}

export function availablePath(parent: string, name: string, folder = false) {
  const safe = diskName(name);
  const extension = folder ? '' : extname(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;
  let path = join(parent, safe);
  for (let index = 2; existsSync(path); index += 1)
    path = join(parent, `${stem} (${index})${extension}`);
  return path;
}
