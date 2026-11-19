// 桌面私有的 Git 审阅视图：不进入 Agent 协议的 JSON Schema，也不带版本。
import type { FileChangeSummary } from './agent';

export interface UncommittedChanges {
  /** false 时前端隐藏入口；错误与非 Git 目录通过 reason 区分。 */
  available: boolean;
  reason: 'not-git' | 'git-unavailable' | 'remote' | null;
  cwd: string;
  repositoryRoot: string | null;
  /** 尚无首个提交的仓库为 null，以空树作为基准。 */
  head: string | null;
  warnings: string[];
  files: FileChangeSummary[];
}
