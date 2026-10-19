// 冻结轮次 unified patch 的纯展示解析：patch 由主进程生成后写后不变，
// 渲染端只做行级拆分与增删行统计，不再引入 diff 计算依赖。

export interface DiffStat {
  added: number;
  deleted: number;
}

export interface DiffRow {
  kind: 'hunk' | 'add' | 'del' | 'context';
  oldLine: number | null;
  newLine: number | null;
  /** 不含前缀字符的行内容。 */
  text: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 增删行数：只统计首个 @@ 之后的行，文件头（---/+++）与行内容形同分隔符的行不会误计。 */
export function diffStatOf(patch: string | null): DiffStat | null {
  if (!patch) return null;
  let added = 0;
  let deleted = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}

/** 拆出带行号的展示行；文件头与 "\ No newline at end of file" 不产出行。 */
export function parseUnifiedPatch(patch: string): DiffRow[] {
  const lines = patch.split('\n');
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1 && line === '') continue;
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: line });
    } else if (!inHunk) continue;
    else if (line.startsWith('+'))
      rows.push({ kind: 'add', oldLine: null, newLine: newLine++, text: line.slice(1) });
    else if (line.startsWith('-'))
      rows.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: line.slice(1) });
    else if (line.startsWith('\\')) continue;
    else
      rows.push({
        kind: 'context',
        // -0,0（纯新增文件）的旧侧没有行号；0 只会出现在这种 hunk 头之后。
        oldLine: oldLine ? oldLine++ : null,
        newLine: newLine ? newLine++ : null,
        text: line.startsWith(' ') ? line.slice(1) : line,
      });
  }
  return rows;
}
