// 更新后首次启动的「更新内容」：数据源是 CHANGELOG.md 每个版本的扁平列表。
// 构建时以 ?raw 内联，运行时只取条目文本，`## Unreleased` 不进弹窗。
import changelog from '../../../../CHANGELOG.md?raw';

export interface ReleaseNote {
  version: string;
  date: string;
  items: string[];
}

const lastSeenKey = 'dela.release-notes.last-seen';

/**
 * 只收已发布版本（`## <版本> - <日期>`，跳过 Unreleased），条目就是弹窗内容。
 * 没有条目的版本（同一天合并发布留下的空分节）不弹。
 */
export function parseReleaseNotes(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  for (const section of markdown.split(/^## /m).slice(1)) {
    const heading = /^(\d+\.\d+\.\d+)\s*-\s*(\S+)/.exec(section);
    if (!heading) continue;
    const items = section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
    if (items.length) notes.push({ version: heading[1]!, date: heading[2]!, items });
  }
  return notes;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

/** (lastSeen, current] 区间内的条目，新版本在前；跨版本升级时合并显示。 */
export function notesBetween(
  notes: ReleaseNote[],
  lastSeen: string,
  current: string,
): ReleaseNote[] {
  return notes
    .filter(
      (note) =>
        compareVersions(note.version, lastSeen) > 0 && compareVersions(note.version, current) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * 本次启动要展示的更新内容，并把当前版本记为已看过。
 * 首次记录不展示；已有版本记录时展示更新条目。
 */
export function takePendingReleaseNotes(current: string): ReleaseNote[] {
  const lastSeen = localStorage.getItem(lastSeenKey);
  localStorage.setItem(lastSeenKey, current);
  if (lastSeen === null) return [];
  const notes = parseReleaseNotes(changelog);
  return notesBetween(notes, lastSeen, current);
}
