export interface WindowState {
  readonly maximized: boolean;
}

export type TrayAction = 'new-chat' | 'new-project';

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
  onTrayAction(listener: (action: TrayAction) => void): () => void;
}

export interface MailAddress {
  readonly name: string | null;
  readonly address: string | null;
}

export interface MailAttachmentInfo {
  readonly filename: string;
  readonly size: number | null;
  readonly part: string | null;
}

export interface MailFolderInfo {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly total: number | null;
  readonly unread: number | null;
  readonly lastSyncedAt: string | null;
}

export interface MailMessageSummary {
  readonly id: number;
  readonly uid: number;
  readonly subject: string | null;
  readonly sender: MailAddress | null;
  readonly date: string | null;
  readonly seen: boolean;
  readonly flagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string | null;
  readonly size: number | null;
}

export interface MailMessageDetail extends MailMessageSummary {
  readonly folderId?: number;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

/** 回收站条目：本地删除的缓存邮件，附原文件夹名与删除时间。 */
export interface MailTrashItem extends MailMessageSummary {
  readonly folderName: string | null;
  readonly deletedAt: string;
}

/** 本地回收站保留天数；0 表示永久保留。 */
export type MailTrashRetention = 7 | 30 | 90 | 0;

export type MailSyncPhase = 'idle' | 'connecting' | 'syncing' | 'error';

export interface MailSyncStatus {
  readonly phase: MailSyncPhase;
  readonly folderPath: string | null;
  readonly processed: number;
  readonly total: number | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface MailAccountInfo {
  readonly address: string;
  readonly lastSyncedAt: string | null;
}

export interface MailState {
  readonly account: MailAccountInfo | null;
  readonly sync: MailSyncStatus;
}

export type MailResult =
  { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
}

export type MailComposeFileKind = 'attachment' | 'inline';

export interface MailComposeFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: MailComposeFileKind;
  readonly previewUrl: string | null;
}

export interface PreparedEmail {
  id: string;
  to: string[];
  subject: string;
  text: string;
  files: MailComposeFile[];
  html?: string;
  savedLocally?: boolean;
  recipientText?: string;
}

export interface MailDraftInput {
  id?: string;
  account: string;
  recipientText: string;
  subject: string;
  text: string;
  html: string;
  attachmentIds: string[];
  inlineImageIds: string[];
}

export interface MailDraftSummary {
  id: string;
  subject: string;
  recipientText: string;
  updatedAt: string;
}

export interface MailSendInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attachmentIds: readonly string[];
  readonly inlineImageIds: readonly string[];
}

export interface MailApi {
  getState(): Promise<MailState>;
  configure(input: MailConfigureInput): Promise<MailResult>;
  disconnect(): Promise<MailResult>;
  listFolders(): Promise<readonly MailFolderInfo[]>;
  listMessages(folderId: number, limit: number): Promise<readonly MailMessageSummary[]>;
  getMessage(messageId: number): Promise<MailMessageDetail>;
  markSeen(messageId: number): Promise<MailResult>;
  deleteMessage(messageId: number): Promise<MailResult>;
  restoreMessage(messageId: number): Promise<MailResult>;
  purgeMessage(messageId: number): Promise<MailResult>;
  emptyTrash(): Promise<MailResult>;
  listTrash(): Promise<readonly MailTrashItem[]>;
  getTrashRetention(): Promise<MailTrashRetention>;
  setTrashRetention(retention: MailTrashRetention): Promise<MailTrashRetention>;
  downloadAttachment(messageId: number, part: string): Promise<MailResult>;
  pickComposeFiles(kind: MailComposeFileKind): Promise<readonly MailComposeFile[]>;
  addComposeImage(dataUrl: string): Promise<MailComposeFile>;
  releaseComposeFiles(ids: readonly string[]): Promise<void>;
  sendMessage(input: MailSendInput): Promise<MailResult>;
  openDraft(id: string): Promise<PreparedEmail>;
  saveDraft(input: MailDraftInput): Promise<MailDraftSummary>;
  listDrafts(account: string): Promise<MailDraftSummary[]>;
  deleteDraft(id: string): Promise<void>;
  confirmDraftClose(): Promise<'save' | 'discard' | 'cancel'>;
  setComposeActive(active: boolean): Promise<void>;
  onRequestClose(listener: () => void): () => void;
  syncNow(): Promise<void>;
  onSyncStatus(listener: (status: MailSyncStatus) => void): () => void;
}

export interface TimetableLesson {
  readonly id: number;
  readonly semester: string;
  readonly courseCode: string;
  readonly courseName: string;
  readonly className: string | null;
  readonly teacher: string | null;
  readonly campus: string | null;
  readonly classroom: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly endPeriod: number;
  readonly periodsText: string;
  readonly weeksText: string;
  readonly weekNumbers: readonly number[];
  readonly credits: number | null;
  readonly note: string | null;
}

export interface TimetableState {
  readonly connected: boolean;
  readonly semester: string;
  readonly lastSyncedAt: string | null;
  readonly semesterStart: string | null;
}

// 日历事件候选色 key，与 renderer 的 --cal-* 设计 token 一一对应。
export const calendarEventColors = [
  'rose',
  'peach',
  'sand',
  'sage',
  'teal',
  'blue',
  'lilac',
  'slate',
] as const;

export type CalendarEventColor = (typeof calendarEventColors)[number];

export interface CalendarEvent {
  readonly id: number;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string | null;
  readonly color: CalendarEventColor | null;
}

export interface CalendarEventInput {
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly location?: string;
  readonly color?: CalendarEventColor;
}

export interface TimetableResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface TimetableApi {
  getState(semester?: string): Promise<TimetableState>;
  connect(): Promise<TimetableResult>;
  disconnect(): Promise<TimetableResult>;
  listLessons(semester?: string): Promise<readonly TimetableLesson[]>;
  listEvents(startAt: string, endAt: string): Promise<readonly CalendarEvent[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  deleteEvent(id: number): Promise<void>;
  setSemesterStart(semester: string, value: string): Promise<void>;
  syncNow(semester?: string): Promise<TimetableResult>;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface ShuiyuanState {
  readonly connected: boolean;
  readonly username: string | null;
  readonly boundAt: string | null;
}

/** 水源主题（帖子）在列表形态下的瘦身视图；字段从 Discourse 载荷挑选，不透传。 */
export interface ShuiyuanTopicSummary {
  readonly id: number;
  readonly title: string;
  readonly excerpt: string | null;
  readonly categoryId: number | null;
  readonly tags: readonly string[];
  readonly postsCount: number;
  readonly views: number | null;
  readonly likeCount: number | null;
  readonly createdAt: string;
  readonly lastPostedAt: string | null;
  readonly pinned: boolean;
  readonly closed: boolean;
  readonly bookmarked: boolean;
  readonly archetype: string;
  readonly lastPosterUsername: string | null;
}

export interface ShuiyuanTopicPage {
  readonly topics: readonly ShuiyuanTopicSummary[];
  /** Discourse `more_topics_url`；null 表示没有下一页。翻页时原样回传。 */
  readonly moreUrl: string | null;
}

export interface ShuiyuanPost {
  readonly id: number;
  readonly postNumber: number;
  readonly username: string;
  readonly name: string | null;
  readonly avatarTemplate: string | null;
  readonly createdAt: string;
  /** 服务端消毒后的楼层 HTML（cooked），渲染前仍走本应用沙箱管线。 */
  readonly cooked: string;
  readonly replyToPostNumber: number | null;
  readonly likeCount: number | null;
  readonly yours: boolean;
}

export interface ShuiyuanTopicDetail {
  readonly id: number;
  readonly title: string;
  readonly categoryId: number | null;
  readonly tags: readonly string[];
  readonly postsCount: number;
  readonly likeCount: number | null;
  readonly views: number | null;
  readonly createdAt: string;
  readonly lastPostedAt: string | null;
  readonly closed: boolean;
  readonly archetype: string;
  readonly bookmarked: boolean;
  /** 楼层 post id 全量；`posts` 为已加载的前段。 */
  readonly stream: readonly number[];
  readonly posts: readonly ShuiyuanPost[];
}

export interface ShuiyuanCategory {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly color: string;
  readonly parentId: number | null;
  readonly topicCount: number | null;
}

export interface ShuiyuanTag {
  readonly name: string;
  readonly topicCount: number | null;
}

export interface ShuiyuanSiteStructure {
  readonly categories: readonly ShuiyuanCategory[];
  readonly tags: readonly ShuiyuanTag[];
}

export interface ShuiyuanNotificationItem {
  readonly id: number;
  readonly type: number;
  readonly read: boolean;
  readonly highPriority: boolean;
  readonly createdAt: string;
  readonly topicId: number | null;
  readonly postNumber: number | null;
  readonly fancyTitle: string | null;
  readonly displayUsername: string | null;
}

export interface ShuiyuanBookmarkItem {
  readonly id: number;
  readonly topicId: number;
  readonly title: string;
  readonly excerpt: string | null;
  readonly createdAt: string;
  readonly linkedPostNumber: number | null;
}

export type ShuiyuanFeed =
  | { readonly kind: 'latest' }
  | { readonly kind: 'featured' }
  | { readonly kind: 'category'; readonly categoryId: number }
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'search'; readonly query: string };

export interface ShuiyuanCounts {
  readonly notifications: number;
  readonly messages: number;
}

/** 关联进项目时持久化的来源引用行（shuiyuan_topics 表的视图）。 */
export interface ShuiyuanSourceRef {
  readonly topicId: number;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string | null;
  readonly categoryName: string | null;
  readonly author: string | null;
  readonly postsCount: number | null;
  readonly addedAt: string;
}

/** Composer 附件上传结果；shortUrl 为 upload:// 形态，可直接写进 Markdown。 */
export interface ShuiyuanUpload {
  readonly shortUrl: string;
  readonly url: string | null;
  readonly originalFilename: string | null;
}

export interface ShuiyuanApi {
  getState(): Promise<ShuiyuanState>;
  /** 打开水源授权窗口：用户在其中登录并授权，随后把站点展示的密文复制回来。 */
  startAuth(): Promise<void>;
  /** 解密并校验用户粘贴的密文，成功后保存 User API Key 并返回绑定状态。 */
  bind(payload: string): Promise<ShuiyuanState>;
  /** 撤销远端 key 并清除本地凭据。 */
  unbind(): Promise<void>;
  /** 分类树与常用标签（主进程内存缓存）。 */
  siteStructure(): Promise<ShuiyuanSiteStructure>;
  /** 主题列表；传 moreUrl 时请求上一页返回的下一页地址。 */
  listTopics(feed: ShuiyuanFeed, moreUrl?: string): Promise<ShuiyuanTopicPage>;
  /** 主题详情；postNumber 提供时从该楼附近加载（通知深链）。 */
  getTopic(id: number, postNumber?: number): Promise<ShuiyuanTopicDetail>;
  /** 按 post id 分段加载楼层（长帖加载更多）。 */
  loadPosts(topicId: number, postIds: readonly number[]): Promise<readonly ShuiyuanPost[]>;
  listBookmarks(): Promise<readonly ShuiyuanBookmarkItem[]>;
  /** 私信会话列表（topic 形态）。 */
  listMessages(): Promise<ShuiyuanTopicPage>;
  listNotifications(): Promise<readonly ShuiyuanNotificationItem[]>;
  /** 全部通知标记已读。 */
  markNotificationsRead(): Promise<void>;
  /** 未读计数（主进程 60s 内存缓存）。 */
  getCounts(): Promise<ShuiyuanCounts>;
  /** 回复主题或私信会话；返回新楼层。replyToPostNumber 为楼层级回复目标（Discourse reply_to_post_number）。 */
  createReply(topicId: number, raw: string, replyToPostNumber?: number): Promise<ShuiyuanPost>;
  /**
   * 上传 Composer 附件（Discourse `/uploads.json` multipart）。
   * 该端点未实测：站点若禁用匿名上传路径或调整限制，以错误提示暴露。
   */
  uploadFile(fileName: string, base64: string): Promise<ShuiyuanUpload>;
  /** 发起新私信；返回会话 topic id。 */
  createMessage(to: readonly string[], title: string, raw: string): Promise<number>;
  /** 收藏/取消收藏主题；返回最新状态。 */
  setBookmarked(topicId: number, on: boolean): Promise<boolean>;
  /** 写入来源引用行（添加到项目前调用）。 */
  addSourceRef(topicId: number): Promise<ShuiyuanSourceRef>;
  getSourceRef(topicId: number): Promise<ShuiyuanSourceRef | null>;
  /** 项目工作区打开水源来源时的文档内容（实时拉取，断网回退 excerpt）。 */
  readSource(topicId: number): Promise<DocumentContent>;
}

/** 应用图标底色：white 对应 Dela_white_bg.png，black 对应 Dela_black_bg.png。 */
export type IconPreference = 'white' | 'black';

/** 页面缩放档位（webContents zoom factor）：百分比阶梯与系统显示缩放一致。 */
export const zoomLevels = [0.9, 1, 1.1, 1.25, 1.5] as const;
export type ZoomPreference = (typeof zoomLevels)[number];

/** 全局字号档位：作用于 rem 字号（--text-* 与 body 默认字号），不影响间距与图标。 */
export const fontScaleLevels = [0.9, 1, 1.1, 1.25] as const;
export type FontScalePreference = (typeof fontScaleLevels)[number];

export interface SettingsApi {
  getTheme(): Promise<ThemePreference>;
  setTheme(theme: ThemePreference): Promise<ThemePreference>;
  getIcon(): Promise<IconPreference>;
  setIcon(icon: IconPreference): Promise<IconPreference>;
  getZoom(): Promise<ZoomPreference>;
  setZoom(zoom: ZoomPreference): Promise<ZoomPreference>;
  getFontScale(): Promise<FontScalePreference>;
  setFontScale(scale: FontScalePreference): Promise<FontScalePreference>;
}

/** LLM 提供商的脱敏视图：密钥永不返回 renderer。 */
export interface LlmProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  model: string;
  /** 开启推理强度后暴露给 composer 的档位子集；空数组表示未开启。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 null。 */
  effort: string | null;
  presetId: string | null;
  active: boolean;
}

export interface LlmSaveInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** 留空且 id 已存在时保留已保存密钥；新建时必填。 */
  apiKey?: string;
  models: string[];
  model: string;
  /** 开启推理强度时暴露的档位（多选）；空数组或缺省表示关闭。 */
  effortLevels?: string[];
  presetId?: string | null;
}

export interface LlmVerifyInput {
  /** 已保存的提供商 id；apiKey 留空时取其存储密钥。 */
  id?: string;
  baseUrl: string;
  apiKey?: string;
}

export interface LlmVerifyResult {
  ok: boolean;
  message: string;
  /** 检测成功时端点返回的模型 id 列表，可能为空。 */
  models?: string[];
}

export interface LlmApi {
  list(): Promise<LlmProviderView[]>;
  save(input: LlmSaveInput): Promise<LlmProviderView>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  /** 为当前使用中的提供商切换模型。 */
  setModel(model: string): Promise<void>;
  /** 为当前使用中的提供商切换推理强度档位（须在其已开启的档位列表内）。 */
  setEffort(level: string): Promise<void>;
  verify(input: LlmVerifyInput): Promise<LlmVerifyResult>;
}

export type SettingsSectionId = 'connections' | 'llm' | 'plugins' | 'appearance' | 'about';

export type GlobalSearchResult = {
  title: string;
  subtitle: string | null;
} & (
  | { kind: 'project'; id: string; target: { page: 'projects'; entryId: string } }
  | { kind: 'chat'; id: string; target: { page: 'chat'; scope: string; sessionId: string } }
  | { kind: 'mail'; id: number; target: { page: 'mail'; messageId: number } }
  | { kind: 'course-file'; id: string; target: { page: 'sources'; sourceId: string } }
  | {
      kind: 'setting';
      id: SettingsSectionId;
      target: { page: 'settings'; section: SettingsSectionId };
    }
);

export interface SearchApi {
  query(query: string): Promise<GlobalSearchResult[]>;
}

export type NotificationSource = 'mail' | 'shuiyuan';
export type NotificationFilter = 'all' | NotificationSource;
export interface NotificationItem {
  id: string;
  source: NotificationSource;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  href:
    | { kind: 'mail'; messageId: number }
    | { kind: 'shuiyuan'; topicId: number; postNumber?: number | null };
}
export interface NotificationState {
  items: readonly NotificationItem[];
  totalCount: number;
  unreadCount: number;
  snoozedUntil: string | null;
  refresh: Record<
    NotificationSource,
    { lastSuccessAt: string | null; error: string | null } | null
  >;
}
export interface NotificationsApi {
  getState(filter?: NotificationFilter): Promise<NotificationState>;
  refresh(): Promise<NotificationState>;
  markRead(id: string): Promise<NotificationState>;
  markAllRead(): Promise<NotificationState>;
  setSnooze(until: string | null): Promise<NotificationState>;
  onUpdate(listener: (state: NotificationState) => void): () => void;
}

/** Composer 发送载荷：markdown 文本（内联图片以 dela-img token 嵌入）、暂存附件与 @ 引用。 */
export interface ChatAskInput {
  text: string;
  attachments: string[];
  context: string[];
}

/** 暂存到主进程的图片/附件：图片持久化到磁盘供历史展示，附件发送后即释放。 */
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

export interface ChatApi {
  stageMedia(input: { name: string; bytes: ArrayBuffer | Uint8Array }): Promise<ChatMediaView>;
  pickMedia(): Promise<ChatMediaView[]>;
  /** 已发送图片的缩略预览；附件或文件缺失时为 null。 */
  readMediaPreview(id: string): Promise<string | null>;
  /** 移除尚未发送的暂存文件（composer 删除 chip、离开视图清理草稿）。 */
  releaseMedia(ids: readonly string[]): void;
  listCommands(): Promise<ChatCommandView[]>;
  saveCommand(input: { id?: string; name: string; prompt: string }): Promise<ChatCommandView>;
  deleteCommand(id: string): void;
}

export interface DelaApi {
  readonly version: string;
  readonly window: WindowApi;
  readonly settings: SettingsApi;
  readonly llm: LlmApi;
  readonly chat: ChatApi;
  readonly mail: MailApi;
  readonly timetable: TimetableApi;
  readonly shuiyuan: ShuiyuanApi;
  readonly canvas: CanvasApi;
  readonly workspace: WorkspaceApi;
  readonly search: SearchApi;
  readonly notifications: NotificationsApi;
}

export interface CanvasCourse {
  id: number;
  name: string;
  term: string;
  code: string;
  syncedAt: string | null;
  error: string | null;
}

export interface SourceItem {
  id: string;
  parentId: string | null;
  courseId: number;
  name: string;
  kind: 'folder' | 'module' | 'file' | 'assignment' | 'page' | 'discussion' | 'link';
  sourceId: string | null;
  dueAt?: string | null;
}

export interface CanvasState {
  connected: boolean;
  syncedAt: string | null;
  courses: CanvasCourse[];
  items: SourceItem[];
}

export interface DocumentContent {
  title: string;
  format: 'html' | 'markdown' | 'text' | 'pdf' | 'image' | 'unsupported';
  text?: string;
  bytes?: Uint8Array;
  previewUrl?: string;
  mime?: string;
  url?: string;
  dueAt?: string | null;
  updatedAt?: string | null;
  revision?: string;
}

export interface CanvasApi {
  getState(): Promise<CanvasState>;
  configure(token: string): Promise<void>;
  disconnect(): Promise<void>;
  syncCourses(): Promise<CanvasState>;
  syncCourse(id: number): Promise<CanvasState>;
  read(sourceId: string): Promise<DocumentContent>;
  download(sourceId: string): Promise<void>;
  openLink(url: string): Promise<void>;
}

export interface WorkspaceEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'note' | 'source' | 'local' | 'imported';
  sourceId: string | null;
  noteId: string | null;
  updatedAt: string;
}

export const workspaceArchiveId = '00000000-0000-4000-8000-000000000001';

export interface WorkspaceViewState {
  tabs: string[];
  active: string | null;
  expanded: string[];
  scroll: Record<string, number>;
}

export interface WorkspaceState {
  entries: WorkspaceEntry[];
  views: Record<string, WorkspaceViewState>;
  directory: string;
}

export interface WorkspaceCreateInput {
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project' | 'note' | 'source';
  sourceId?: string;
  text?: string;
}

export interface WorkspaceApi {
  getState(): Promise<WorkspaceState>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceEntry>;
  update(
    id: string,
    input: { name?: string; parentId?: string | null; kind?: 'folder' | 'project' },
  ): Promise<void>;
  remove(id: string): Promise<void>;
  read(id: string): Promise<DocumentContent>;
  saveNote(id: string, text: string, revision: string): Promise<string>;
  importFiles(parentId: string | null): Promise<void>;
  importDroppedFiles(parentId: string | null, files: File[]): Promise<void>;
  openLocal(id: string): Promise<void>;
  chooseDirectory(): Promise<string>;
  saveView(scope: string, state: WorkspaceViewState): Promise<void>;
  getChat(scope: string): Promise<WorkspaceChat>;
  newChat(scope: string): Promise<WorkspaceChat>;
  listChats(scope: string, query: string): Promise<ChatSessionSummary[]>;
  openChat(scope: string, sessionId: string): Promise<WorkspaceChat>;
  deleteChat(scope: string, sessionId: string): Promise<void>;
  ask(scope: string, input: ChatAskInput): Promise<WorkspaceChat>;
  cancelAsk(scope: string): Promise<void>;
  onChatUpdate(listener: (scope: string, chat: WorkspaceChat) => void): () => void;
}

export interface AgentToolResult {
  id: string;
  name: string;
  input: unknown;
  /** 执行结果；运行中的占位步骤（startedAt 已有、output 尚缺）没有输出。 */
  output?: unknown;
  /** 本步骤开始执行的 epoch 毫秒；旧会话与更早的记录没有。 */
  startedAt?: number;
  /** 本步骤完成的 epoch 毫秒；运行中或被中断的步骤没有。 */
  finishedAt?: number;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface WorkspaceChat {
  sessionId: string | null;
  running?: boolean;
  activeTool?: string;
  configured: boolean;
  /** 当前使用中的提供商名称；未配置时为 null。 */
  providerName: string | null;
  model: string;
  /** 当前提供商的可选模型，驱动 composer 下拉。 */
  models: string[];
  /** 当前提供商开启的推理强度档位；空数组表示未开启，composer 显示 default 且不可改。 */
  effortLevels: string[];
  /** 当前选中的推理强度档位；未开启时为 null。 */
  effort: string | null;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources?: { key: string; title: string }[];
    /** 用户消息携带的内联图片（按输入顺序）；id 对应 chat-media 落盘文件。 */
    images?: { id: string; name: string }[];
    /** 用户消息携带的文本附件名；内容已进入当轮模型上下文，文件不保留。 */
    attachments?: { name: string }[];
    toolResults?: AgentToolResult[];
    /** 按发生顺序保存公开说明、思考过程与相邻工具组；旧会话没有 parts。 */
    parts?: (
      | { type: 'text'; text: string }
      | { type: 'reasoning'; text: string; startedAt?: number; finishedAt?: number }
      | { type: 'tools'; results: AgentToolResult[] }
    )[];
    startedAt?: number;
    finishedAt?: number;
    interrupted?: boolean;
    /** 用户主动停止：保留已生成的部分内容，不追加中断说明文案。 */
    stopped?: boolean;
  }[];
}
