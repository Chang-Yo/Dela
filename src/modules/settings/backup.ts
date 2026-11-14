/** 导出本机数据：复制到用户选定的位置，界面不做任何文件操作。 */
export interface BackupApi {
  exportData(): Promise<BackupResult>;
}

export type BackupResult =
  /**
   * skipped 是没能复制成功的顶层条目名，原因不止被占用（还可能是权限、磁盘空间、符号链接），
   * 所以只回报名字，让界面说「没复制成功」而不是断言原因。
   */
  | { status: 'exported'; path: string; skipped: string[] }
  | { status: 'cancelled' }
  /** 选定的位置不能用（例如落在 Dela 自己的数据目录里），reason 直接给用户看。 */
  | { status: 'failed'; reason: string };
