import type { WorkspaceEntry } from '../../../modules/workspace/contract';

function isInside(path: string, base: string): boolean {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(base);
  const normalize = (value: string) =>
    windows ? value.replaceAll('\\', '/').toLowerCase() : value;
  return normalize(path).startsWith(normalize(base).replace(/\/+$/, '') + '/');
}

export function libraryEntriesOf(entries: WorkspaceEntry[], libraryRoot: string): WorkspaceEntry[] {
  const children = new Map<string, WorkspaceEntry[]>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry]);
  }
  const hidden = new Set<string>();
  const queue = entries.filter(
    (entry) =>
      entry.kind === 'project' &&
      (entry.remoteId || (entry.path && !isInside(entry.path, libraryRoot))),
  );
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    if (hidden.has(entry.id)) continue;
    hidden.add(entry.id);
    queue.push(...(children.get(entry.id) ?? []));
  }
  return entries.filter((entry) => !hidden.has(entry.id));
}
