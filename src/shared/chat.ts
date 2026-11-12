import type { z } from 'zod';
import type {
  chatAskInputSchema,
  chatCommandViewSchema,
  chatCommentSchema,
  chatMediaViewSchema,
  chatQueuedDraftSchema,
  fileChangeDetailSchema,
  fileChangeSummarySchema,
  turnChangesSchema,
} from '../core/protocol/agent';

export type ChatComment = z.infer<typeof chatCommentSchema>;
export type ChatAskInput = z.infer<typeof chatAskInputSchema>;
export type ChatMediaView = z.infer<typeof chatMediaViewSchema>;
export type ChatQueuedDraft = z.infer<typeof chatQueuedDraftSchema>;
export type ChatCommandView = z.infer<typeof chatCommandViewSchema>;
export type FileChangeSummary = z.infer<typeof fileChangeSummarySchema>;
export type FileChangeDetail = z.infer<typeof fileChangeDetailSchema>;
export type TurnChanges = z.infer<typeof turnChangesSchema>;

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

export interface ChatApi {
  listTurnChanges(sessionId: string): Promise<TurnChanges[]>;
  readTurnChanges(
    sessionId: string,
    turnId: string,
    includeStats?: boolean,
  ): Promise<TurnChanges | null>;
  readTurnFileChange(sessionId: string, turnId: string, path: string): Promise<FileChangeDetail>;
  readUncommittedChanges(sessionId: string): Promise<UncommittedChanges>;
  readUncommittedFileChange(sessionId: string, path: string): Promise<FileChangeDetail>;
  /** 会话目录能否做未提交改动审阅（轻探测，两次 git 调用，不做文件扫描）。 */
  uncommittedAvailability(
    sessionId: string,
  ): Promise<Pick<UncommittedChanges, 'available' | 'reason'>>;
  /** 会话内文件的本机绝对路径（相对路径按会话 cwd 解析，须真实存在）；应用内预览标签以它作标签键。 */
  locateFile(sessionId: string, path: string): Promise<string>;
  /** 用 VS Code 打开会话内文件；相对路径按会话 cwd 解析。 */
  openInVsCode(sessionId: string, path: string): Promise<void>;
  stageMedia(input: { name: string; bytes: ArrayBuffer | Uint8Array }): Promise<ChatMediaView>;
  pickMedia(): Promise<ChatMediaView[]>;
  /** 已发送图片的缩略预览；附件或文件缺失时为 null。 */
  readMediaPreview(id: string): Promise<string | null>;
  /** 移除尚未发送的暂存文件（composer 删除 chip、离开视图清理草稿）。 */
  releaseMedia(ids: readonly string[]): void;
  listCommands(): Promise<ChatCommandView[]>;
  saveCommand(input: { id?: string; name: string; prompt: string }): Promise<ChatCommandView>;
  deleteCommand(id: string): void;
  /** 在系统文件管理器中定位本轮生成的文件；相对路径按会话 cwd 解析，文件须真实存在。 */
  revealFile(sessionId: string, path: string): Promise<void>;
  /** 用系统默认程序打开本轮生成的文件；相对路径按会话 cwd 解析，文件须真实存在。 */
  openFile(sessionId: string, path: string): Promise<void>;
}
