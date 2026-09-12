export interface WindowState {
  readonly maximized: boolean;
}

export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  getState(): Promise<WindowState>;
  onStateChange(listener: (state: WindowState) => void): () => void;
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
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

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
  downloadAttachment(messageId: number, part: string): Promise<MailResult>;
  pickComposeFiles(kind: MailComposeFileKind): Promise<readonly MailComposeFile[]>;
  addComposeImage(dataUrl: string): Promise<MailComposeFile>;
  releaseComposeFiles(ids: readonly string[]): Promise<void>;
  sendMessage(input: MailSendInput): Promise<MailResult>;
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
  setSemesterStart(semester: string, value: string): Promise<void>;
  syncNow(semester?: string): Promise<TimetableResult>;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface SettingsApi {
  getTheme(): Promise<ThemePreference>;
  setTheme(theme: ThemePreference): Promise<ThemePreference>;
}

export interface DelaApi {
  readonly version: string;
  readonly window: WindowApi;
  readonly settings: SettingsApi;
  readonly mail: MailApi;
  readonly timetable: TimetableApi;
  readonly canvas: CanvasApi;
  readonly workspace: WorkspaceApi;
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
  kind: 'folder' | 'project' | 'note' | 'source' | 'local';
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
  openLocal(id: string): Promise<void>;
  chooseDirectory(): Promise<string>;
  saveView(scope: string, state: WorkspaceViewState): Promise<void>;
  getChat(scope: string): Promise<WorkspaceChat>;
  configureModel(key: string, model: string): Promise<void>;
  ask(scope: string, prompt: string, context: string[]): Promise<WorkspaceChat>;
}

export interface WorkspaceChat {
  configured: boolean;
  model: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources?: { key: string; title: string }[];
  }[];
}
