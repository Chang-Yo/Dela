// unified patch 的增删行统计：patch 由主进程生成，渲染端只读不算。

export interface DiffStat {
  added: number;
  deleted: number;
}

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
