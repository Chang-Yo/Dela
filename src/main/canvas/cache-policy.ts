export interface CanvasCacheCleanupEntry {
  key: string;
  path: string;
  bytes: number;
  term: string;
  courseId: number | null;
  lastUsedAt: number;
  pinned: boolean;
}

export interface CanvasCacheCleanupPolicy {
  maxBytes: number;
  keepCurrentTerm: boolean;
}

export const CACHE_PROTECTION_MS = 60_000;

export function selectCanvasCacheEntries(
  entries: CanvasCacheCleanupEntry[],
  policy: CanvasCacheCleanupPolicy,
  currentTerm: string | undefined,
  now = Date.now(),
): CanvasCacheCleanupEntry[] {
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const keepCurrentTerm = policy.keepCurrentTerm && currentTerm !== undefined;
  const candidates = entries
    .filter((entry) => !entry.pinned && now - entry.lastUsedAt >= CACHE_PROTECTION_MS)
    .sort(
      (a, b) =>
        Number(keepCurrentTerm && a.term === currentTerm) -
          Number(keepCurrentTerm && b.term === currentTerm) || a.lastUsedAt - b.lastUsedAt,
    );
  const selected: CanvasCacheCleanupEntry[] = [];
  for (const entry of candidates) {
    if (bytes <= policy.maxBytes && (!keepCurrentTerm || entry.term === currentTerm)) break;
    selected.push(entry);
    bytes -= entry.bytes;
  }
  return selected;
}
