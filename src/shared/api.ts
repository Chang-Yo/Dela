// 聚合出口：领域契约已拆分到同目录领域文件。
// 本文件只 import 并 re-export，保证全仓既有 `from '../shared/api'` 等 import 不变；
// 领域类型的变化请直接改对应领域文件，不在此处添加逻辑。
import type { CapabilityApi } from './capabilities';
import type { CanvasApi } from './canvas';
import type { ChatApi } from './chat';
import type { LayoutApi } from './layout';
import type { LlmApi } from './llm';
import type { MailApi } from './mail';
import type { NotificationsApi } from './notifications';
import type { RemoteApi } from './remotes';
import type { SearchApi } from './search';
import type { SessionApi } from './session';
import type { SettingsApi } from './settings';
import type { VsjtuApi } from './vsjtu';
export type {
  AgentCapabilityView,
  CapabilityApi,
  McpConnectionStatus,
  McpServerConfig,
  McpServerView,
  SkillScope,
  SkillView,
  WebSearchConfig,
} from './capabilities';
import type { ShuiyuanApi } from './shuiyuan';
import type { TimetableApi } from './timetable';
import type { TodoApi } from './todo';
import type { TerminalApi } from './terminal';
import type { WindowApi } from './window';
import type { WorkspaceApi } from './workspace';

export interface DelaApi {
  readonly vsjtu: VsjtuApi;
  capability: CapabilityApi;
  readonly todo: TodoApi;
  readonly terminal: TerminalApi;
  readonly version: string;
  /** 主进程在数据库初始化前判定；已有用户数据的更新和重启均为 false。 */
  readonly firstLaunch: boolean;
  readonly window: WindowApi;
  readonly settings: SettingsApi;
  readonly llm: LlmApi;
  readonly chat: ChatApi;
  readonly mail: MailApi;
  readonly timetable: TimetableApi;
  readonly shuiyuan: ShuiyuanApi;
  readonly canvas: CanvasApi;
  readonly workspace: WorkspaceApi;
  readonly session: SessionApi;
  readonly remotes: RemoteApi;
  readonly layout: LayoutApi;
  readonly search: SearchApi;
  readonly notifications: NotificationsApi;
}

export type { WindowState, TrayAction, WindowApi } from './window';

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
  ShuiyuanApi,
} from './shuiyuan';

export type {
  ThemePreference,
  IconPreference,
  ZoomPreference,
  FontScalePreference,
  TaskNotificationPrefs,
  NoteEditModePreference,
  WorkspacePrefs,
  SettingsApi,
  SettingsSectionId,
} from './settings';
export { zoomLevels, fontScaleLevels } from './settings';

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
  HelperDegradation,
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
} from './remotes';

export type {
  NotificationSource,
  NotificationFilter,
  NotificationItem,
  NotificationState,
  NotificationsApi,
} from './notifications';

export type { ChatAskInput, ChatMediaView, ChatCommandView, ChatApi } from './chat';

export type { CanvasCourse, SourceItem, CanvasState, CanvasApi } from './canvas';

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
  RunEvent,
  RunStatus,
  ChatStreamEvent,
} from './session';

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
