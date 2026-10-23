// Pi packages 契约：包的来源、启停与安装由 main 持有，渲染端只持镜像。
// 包里的扩展与 Dela 同进程同权限运行；Dela 负责告知、来源展示、启用、禁用与卸载，
// 包本身的行为由包作者与选择启用它的用户负责（见 docs/terms.md）。

export type PackageSourceType = 'npm' | 'git' | 'local';

/** 一个包里各类资源的数量（来自 Pi 的解析结果）。 */
export interface PackageResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

/** 按资源类型的开关：false 表示这一类都不加载（对应 Pi package 过滤里的 `[]`）。 */
export interface PackageResourceToggles {
  extensions: boolean;
  skills: boolean;
  prompts: boolean;
}

/** 包实际提供的东西：设置页的 Skills、自定义指令与 MCP 分区据此把它们列在各自的位置。 */
export interface PackageProvides {
  skills: { name: string; description: string; path: string }[];
  prompts: { name: string; description: string; argumentHint?: string }[];
  /** 扩展注册的 `/` 命令。 */
  commands: { name: string; description: string }[];
  /** 扩展注册的工具名。 */
  tools: string[];
  /** 扩展注册的 MCP 服务器；detail 是启动命令或地址。 */
  mcpServers: { name: string; detail: string }[];
  /** 命令、工具与 MCP 服务器要加载扩展代码才知道：只有启用且开了扩展的包为 true。 */
  extensionsInspected: boolean;
}

export interface PiPackageView {
  id: string;
  /** Pi 认得的来源串：npm:<name>@<version> / git:<host>/<path>@<ref> / 本地绝对路径。 */
  source: string;
  type: PackageSourceType;
  /** 展示名：npm 包名、仓库路径或目录名。 */
  name: string;
  /** package.json 的 version；读不到时为 null。 */
  version: string | null;
  description: string | null;
  /** 安装目录（本地来源即其自身路径）；尚未装好时为 null。 */
  installedPath: string | null;
  enabled: boolean;
  resources: PackageResourceToggles;
  counts: PackageResourceCounts;
  provides: PackageProvides;
  /** 按名称停用的 prompt 模板（设置 › 自定义指令里逐个开关）。 */
  disabledPrompts: string[];
  installedAt: string;
  /** 加载这个包时 Pi 报出的问题（扩展加载失败、资源冲突等）。 */
  diagnostics: string[];
}

/** 包管理运行时：npm 从哪来。git 来源另需系统 git（Windows 上 Dela 自带 MinGit）。 */
export type NpmRuntimeState =
  | { status: 'disabled' }
  | { status: 'checking' }
  | { status: 'installing'; phase: string; received?: number; total?: number }
  | { status: 'ready'; npm: string; version: string; origin: 'system' | 'bundled' }
  | { status: 'error'; error: string };

export type NpmRegistry = 'npmjs' | 'npmmirror';

export interface PackageSettings {
  /** 总开关：关闭时不加载任何包，设置页只显示开启入口。 */
  enabled: boolean;
  runtime: NpmRuntimeState;
  registry: NpmRegistry;
}

export interface PackageProgress {
  source: string;
  message: string;
}

/** 扩展请求界面交互（rpc 级）：对话框要回复，其余是单向通知。
 *  Pi 给所有扩展同一个 ui 上下文，调用方是哪个扩展无从得知，所以只标会话。 */
export type ExtensionUiRequest =
  | {
      id: string;
      sessionId: string;
      kind: 'select';
      title: string;
      options: string[];
      timeoutMs?: number;
    }
  | {
      id: string;
      sessionId: string;
      kind: 'confirm';
      title: string;
      message: string;
      timeoutMs?: number;
    }
  | {
      id: string;
      sessionId: string;
      kind: 'input';
      title: string;
      placeholder?: string;
      timeoutMs?: number;
    }
  | {
      id: string;
      sessionId: string;
      kind: 'editor';
      title: string;
      prefill?: string;
    };

/** 对话框的回复：null 表示取消。confirm 回 boolean，其余回字符串。 */
export type ExtensionUiReply = string | boolean | null;

/** 扩展写给会话的状态（setStatus / setWidget 文本 / setWorkingMessage），按会话推送全量。 */
export interface ExtensionSessionState {
  sessionId: string;
  statuses: { key: string; text: string }[];
  widgets: { key: string; lines: string[]; placement: 'aboveEditor' | 'belowEditor' }[];
  workingMessage: string | null;
}

export type ExtensionUiEvent =
  | { type: 'notify'; sessionId: string; message: string; level: 'info' | 'warning' | 'error' }
  | { type: 'editor-text'; sessionId: string; text: string; mode: 'replace' | 'paste' }
  | { type: 'error'; sessionId: string; extension: string; message: string }
  | { type: 'unsupported'; sessionId: string; feature: string };

export interface PackageApi {
  settings(): Promise<PackageSettings>;
  /** 打开总开关：检测系统 npm，没有就下载 Dela 专用的 Node 运行时。 */
  enable(): Promise<PackageSettings>;
  disable(): Promise<PackageSettings>;
  cancelRuntimeInstall(): Promise<void>;
  setRegistry(registry: NpmRegistry): Promise<PackageSettings>;
  onSettingsChanged(listener: (settings: PackageSettings) => void): () => void;
  list(): Promise<PiPackageView[]>;
  /** 安装来源（npm:… / git:… / https://… / 本地路径），装好后默认不启用。 */
  install(source: string): Promise<PiPackageView[]>;
  /** 选择本地包目录；取消返回 null。 */
  pickLocal(): Promise<string | null>;
  setEnabled(id: string, enabled: boolean): Promise<PiPackageView[]>;
  setResources(id: string, resources: PackageResourceToggles): Promise<PiPackageView[]>;
  /** 单个 prompt 模板的开关（按名称，与 Skills 的全局名单一样）。 */
  setPromptEnabled(name: string, enabled: boolean): Promise<PiPackageView[]>;
  update(id: string): Promise<PiPackageView[]>;
  remove(id: string): Promise<PiPackageView[]>;
  reveal(id: string): Promise<void>;
  onProgress(listener: (progress: PackageProgress) => void): () => void;
  /** 扩展发起的对话框；渲染端回复 reply。 */
  onUiRequest(listener: (request: ExtensionUiRequest) => void): () => void;
  reply(id: string, value: ExtensionUiReply): Promise<void>;
  /** 扩展那边超时或取消了对话框：渲染端据此关掉它。 */
  onUiDismiss(listener: (id: string) => void): () => void;
  /** 输入框正文变化时上报：扩展的 getEditorText 是同步接口，只能读这份。 */
  reportEditorText(sessionId: string, text: string): void;
  onUiEvent(listener: (event: ExtensionUiEvent) => void): () => void;
  onSessionState(listener: (state: ExtensionSessionState) => void): () => void;
  /** 渲染端打开会话时补拉一次当前状态。 */
  sessionState(sessionId: string): Promise<ExtensionSessionState>;
}
