/** 对回复正文中一段选中文字的评论；comment 为空即只引用这段文字。 */
export interface ChatComment {
  quote: string;
  comment: string;
}

/** Composer 发送载荷：markdown 文本（内联图片以 dela-img token 嵌入）、暂存附件、@ 引用与评论。 */
export interface ChatAskInput {
  text: string;
  attachments: string[];
  context: string[];
  comments: ChatComment[];
  /** 编辑重发：丢弃会话中最后一条用户消息及其后内容，以 text 重新发起。 */
  replaceLastUser?: boolean;
}

/** 图片和文档保留本地副本；文本附件发送后释放内存。 */
export interface ChatMediaView {
  id: string;
  name: string;
  size: number;
  kind: 'image' | 'attachment';
  /** 图片的缩略预览 data URL；附件为 null。 */
  previewUrl: string | null;
}

export interface ChatCommandView {
  id: string;
  name: string;
  prompt: string;
}

/** 会话里 Pi 扩展注册的命令与 package 带来的 prompt 模板（输入框 `/` 候选）。 */
export interface ChatSlashCommand {
  name: string;
  description: string;
  kind: 'extension' | 'prompt';
  /** 所属包的展示名。 */
  source: string;
  argumentHint?: string;
}

export interface FileChangeSummary {
  /** 相对本次比较工作目录的路径，统一使用 /。 */
  path: string;
  status: 'added' | 'modified' | 'deleted';
  beforeBytes: number | null;
  afterBytes: number | null;
  textDiff: boolean;
  /** 轮次摘要按需返回；null 表示无法统计，省略表示未请求统计。 */
  stat?: { added: number; deleted: number } | null;
}

export interface FileChangeDetail extends FileChangeSummary {
  before: string | null;
  after: string | null;
  patch: string | null;
  note: string | null;
}

export interface TurnChanges {
  turnId: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  runStatus: 'completed' | 'failed' | 'stopped';
  state: 'complete' | 'partial' | 'unavailable';
  warnings: string[];
  files: FileChangeSummary[];
}

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
  /** 会话已打开时，Pi 扩展命令与 package 的 prompt 模板；会话未建实例时为空。 */
  listSessionCommands(sessionId: string): Promise<ChatSlashCommand[]>;
  saveCommand(input: { id?: string; name: string; prompt: string }): Promise<ChatCommandView>;
  deleteCommand(id: string): void;
  /** 在系统文件管理器中定位本轮生成的文件；相对路径按会话 cwd 解析，文件须真实存在。 */
  revealFile(sessionId: string, path: string): Promise<void>;
  /** 用系统默认程序打开本轮生成的文件；相对路径按会话 cwd 解析，文件须真实存在。 */
  openFile(sessionId: string, path: string): Promise<void>;
}
