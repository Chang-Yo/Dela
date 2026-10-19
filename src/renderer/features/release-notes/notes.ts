// 更新后首次启动的「更新内容」：数据源是 CHANGELOG.md 每个版本的「### 亮点」小节（面向用户）。
// 构建时以 ?raw 内联，运行时只取亮点，开发条目不进弹窗。
import changelog from '../../../../CHANGELOG.md?raw';

export interface ReleaseNote {
  version: string;
  date: string;
  highlights: string[];
}

const lastSeenKey = 'dela.release-notes.last-seen';

/** 只收已发布版本（跳过 Unreleased），没写亮点的版本不收。 */
export function parseReleaseNotes(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  for (const section of markdown.split(/^## /m).slice(1)) {
    const heading = /^(\d+\.\d+\.\d+)\s*-\s*(\S+)/.exec(section);
    if (!heading) continue;
    const block = /^### 亮点\s*$([\s\S]*?)(?=^##|$(?![\s\S]))/m.exec(section);
    const highlights = (block?.[1] ?? '')
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
    if (highlights.length) notes.push({ version: heading[1]!, date: heading[2]!, highlights });
  }
  return notes;
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

/** (lastSeen, current] 区间内的亮点，新版本在前；跨版本升级时合并显示。 */
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
 * 首次安装只记录不展示（新用户走引导页）；没有记录但不是首次安装的老用户，展示当前版本的亮点。
 */
export function takePendingReleaseNotes(current: string, firstLaunch: boolean): ReleaseNote[] {
  const lastSeen = localStorage.getItem(lastSeenKey);
  localStorage.setItem(lastSeenKey, current);
  if (firstLaunch && lastSeen === null) return [];
  const notes = parseReleaseNotes(changelog);
  if (lastSeen === null) return notes.filter((note) => note.version === current);
  return notesBetween(notes, lastSeen, current);
}
