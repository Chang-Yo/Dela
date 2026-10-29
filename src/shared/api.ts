// 聚合出口：领域契约在同目录领域文件，本文件只 re-export，保证全仓既有 import 路径不变。
// 领域类型变化请直接改对应文件，不在此处添加逻辑。
import type { BackupApi } from './backup';
import type { CacheApi } from './cache';
import type { CapabilityApi } from './capabilities';
import type { CanvasApi } from './canvas';
import type { ChatApi } from './chat';
import type { PackageApi } from './packages';
import type { ConsentApi } from './consent';
import type { LayoutApi } from './layout';
import type { LlmApi } from './llm';
import type { MailApi } from './mail';
import type { NotificationsApi } from './notifications';
import type { RemoteApi } from './remotes';
import type { SearchApi } from './search';
import type { SessionApi, SidechatApi } from './session';
import type { SettingsApi } from './settings';
import type { VsjtuApi } from './vsjtu';
export type {
  AgentCapabilityView,
  CapabilityApi,
  McpConnectionStatus,
  McpServerConfig,
  McpServerView,
  SkillOrigin,
  SkillView,
  WebSearchEntry,
  WebSearchEntryInput,
  WebSearchEntrySummary,
  WebSearchKeySource,
} from './capabilities';
import type { ShuiyuanApi } from './shuiyuan';
import type { TimetableApi } from './timetable';
import type { TodoApi } from './todo';
import type { TerminalApi } from './terminal';
import type { UpdateApi } from './update';
import type { WindowApi } from './window';
import type { WorkspaceApi } from './workspace';

export interface DelaApi {
  readonly platform: string;
  readonly vsjtu: VsjtuApi;
  capability: CapabilityApi;
  readonly packages: PackageApi;
  readonly todo: TodoApi;
  readonly terminal: TerminalApi;
  readonly version: string;
  /** NSIS 更新安装完成后启动，供界面提示实际运行的版本。 */
  readonly updatedOnLaunch: boolean;
  readonly window: WindowApi;
  readonly settings: SettingsApi;
  /** 条款接受记录与导出本机数据只在引导的条款接受页使用（见 docs/DEVELOPMENT.md）。 */
  readonly consent: ConsentApi;
  readonly backup: BackupApi;
  /** 设置 › 通用 底部的缓存占用与清理。 */
  readonly cache: CacheApi;
  readonly llm: LlmApi;
  readonly chat: ChatApi;
  readonly mail: MailApi;
  readonly timetable: TimetableApi;
  readonly shuiyuan: ShuiyuanApi;
  readonly canvas: CanvasApi;
  readonly workspace: WorkspaceApi;
  readonly session: SessionApi;
  readonly sidechat: SidechatApi;
  readonly remotes: RemoteApi;
  readonly layout: LayoutApi;
  readonly search: SearchApi;
  readonly notifications: NotificationsApi;
  readonly update: UpdateApi;
}

export type { WindowState, TrayAction, WindowApi } from './window';
export type { BackupApi, BackupResult } from './backup';
export type { CacheApi, CacheClearResult } from './cache';
export type { ConsentApi, ConsentDocument } from './consent';

export type {
  MailAddress,
  MailAttachmentInfo,
  MailFolderInfo,
  MailMessageSummary,
  MailMessageDetail,
  MailTrashItem,
  MailTrashRetention,
  MailSyncPhase,
  MailSyncStatus,
  MailAccountInfo,
  MailState,
  MailResult,
  MailServerConfig,
  MailConfigureInput,
  MailComposeFileKind,
  MailComposeFile,
  PreparedEmail,
  MailDraftInput,
  MailDraftSummary,
  MailSendInput,
  MailApi,
} from './mail';

export type {
  TimetableLesson,
  TimetableState,
  CalendarEventColor,
  CalendarEvent,
  CalendarEventInput,
  TimetableResult,
  TimetableApi,
} from './timetable';
export { calendarEventColors } from './timetable';

export type {
  ShuiyuanState,
  ShuiyuanTopicSummary,
  ShuiyuanTopicPage,
  ShuiyuanPost,
  ShuiyuanTopicDetail,
  ShuiyuanCategory,
  ShuiyuanTag,
  ShuiyuanCustomEmoji,
  ShuiyuanSiteStructure,
  ShuiyuanNotificationItem,
  ShuiyuanBookmarkItem,
  ShuiyuanFeed,
  ShuiyuanCounts,
  ShuiyuanSourceRef,
  ShuiyuanUpload,
  ShuiyuanTopicLink,
  ShuiyuanApi,
} from './shuiyuan';

export type {
  ThemePreference,
  IconPreference,
  ZoomPreference,
  ExperimentKey,
  ExperimentState,
  TaskNotificationPrefs,
  SettingsApi,
  SettingsSectionId,
} from './settings';
export { zoomLevels, fontSizeMin, fontSizeMax, fontSizeDefault } from './settings';

export type {
  KeybindingMap,
  KeybindingOverrides,
  ShortcutAction,
  ShortcutActionId,
  ShortcutConflict,
  ShortcutScope,
} from './keybindings';

export type {
  LlmModelSettings,
  LlmProviderView,
  LlmSaveInput,
  LlmVerifyInput,
  LlmVerifyResult,
  LlmApi,
} from './llm';

export type { GlobalSearchResult, SearchApi } from './search';

export type {
  RemoteChannelState,
  RemoteChannelStatus,
  RemoteTask,
  RemoteApi,
  RemoteBrowseResult,
  RemoteConnection,
  RemoteDirectoryEntry,
  RemoteDraft,
  RemotePortEntry,
  RemotePortTunnel,
  RemotePortsState,
  RemotePrepare,
  RemoteProbe,
  RemoteSetupProgress,
  RemoteSetupStep,
  SshConfigHost,
} from './remotes';

export type {
  NotificationSource,
  NotificationFilter,
  NotificationItem,
  NotificationState,
  NotificationsApi,
} from './notifications';

export type {
  ChatAskInput,
  ChatComment,
  ChatMediaView,
  ChatCommandView,
  ChatSlashCommand,
  ChatApi,
  FileChangeSummary,
  FileChangeDetail,
  TurnChanges,
  UncommittedChanges,
} from './chat';

export type {
  CachedCourseFile,
  CanvasCourse,
  CanvasExportResult,
  SourceItem,
  CanvasState,
  CanvasApi,
} from './canvas';

export type {
  ExtensionSessionState,
  ExtensionUiEvent,
  ExtensionUiReply,
  ExtensionUiRequest,
  NpmRegistry,
  NpmRuntimeState,
  PackageApi,
  PackageProgress,
  PackageProvides,
  PackageResourceToggles,
  PackageSettings,
  PiPackageView,
} from './packages';

export type {
  DocumentContent,
  OfficeExportInfo,
  OfficeExportProgress,
  OfficeExportEvent,
} from './documents';

export type {
  WorkspaceEntry,
  WorkspaceState,
  WorkspaceCreateInput,
  WorkspaceApi,
} from './workspace';
export { workspaceArchiveId } from './workspace';

export type {
  AgentToolOutput,
  AgentToolResult,
  ChatScope,
  ChatSessionSummary,
  ContextUsageView,
  WorkspaceChat,
  SessionApi,
  SidechatApi,
  SidechatView,
  RunEvent,
  RunStatus,
  ChatStreamEvent,
  MainSessionCommand,
  SessionCommandName,
} from './session';

export { SESSION_COMMANDS, parseSessionCommand } from './session';

export type {
  TabKind,
  TabId,
  SplitOrientation,
  GroupNode,
  SplitNode,
  LayoutNode,
  WorkbenchLayout,
  LayoutApi,
} from './layout';

export type { TodoStatus, TodoItem, TodoState, TodoSaveInput, TodoApi } from './todo';

export type { UpdateApi, UpdateSnapshot, UpdatePhase, UpdateReason } from './update';
