import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';

export interface TurnFile {
  path: string;
  kind: 'write' | 'edit';
  /** 本轮命中次数（同一文件多次编辑时合并为一条）。 */
  count: number;
}

const hasPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** 汇总一轮回答里 write / edit 命中过的文件：按首次出现排序，同一路径合并计数。 */
export function collectTurnFiles(
  parts: NonNullable<WorkspaceChat['messages'][number]['parts']>,
): TurnFile[] {
  const files = new Map<string, TurnFile>();
  for (const part of parts) {
    if (part.type !== 'tools') continue;
    for (const result of part.results as AgentToolResult[]) {
      if (result.name !== 'write' && result.name !== 'edit') continue;
      const path = (result.input as { path?: unknown } | null)?.path;
      if (!hasPath(path)) continue;
      const existing = files.get(path);
      if (existing) existing.count += 1;
      else files.set(path, { path, kind: result.name, count: 1 });
    }
  }
  return [...files.values()];
}

/** 只用于展示：跨平台取末段与所在目录，不保证与宿主 path 规则完全一致。 */
const lastSeparator = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
export const basenameOf = (path: string) => path.slice(lastSeparator(path) + 1) || path;
export const dirnameOf = (path: string) => path.slice(0, Math.max(0, lastSeparator(path))) || path;
