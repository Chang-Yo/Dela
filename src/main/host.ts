// 主进程与桌面宿主之间的端口：agent 只依赖这些接口，Electron 实现在 app 中注入。
import type { RemoteTarget } from './remotes/transport';

/** 渲染进程的窗口或 WebContents 句柄；core 不解释它，原样交还给桌面实现。 */
export type ClientHandle = object;

export interface HostPorts {
  paths: Paths;
  secrets: SecretStore;
  notifier: Notifier;
  broadcaster: ClientBroadcaster;
  imageCodec: ImageCodec;
  desktop: Desktop;
  network: Network;
  /** 宿主打开并迁移好的数据库；表结构与迁移归宿主（core 只读写 sessions 与自己的设置键）。 */
  database(): SqlDatabase;
  projects: Projects;
}

export interface Paths {
  userData(): string;
  home(): string;
  documents(): string;
  temp(): string;
  /** 用户选定的 Dela 数据目录，工作区与通用会话目录都在其下。 */
  storage(): string;
  /** 随应用分发的二进制目录：开发时在仓库内，打包后在 resources/。 */
  bundled(name: BundledResource): string;
  /** Agent 的 bash；找不到时抛出带安装指引的错误。 */
  bash(): string;
}

export type BundledResource = 'dela-helper' | 'remote-rg' | 'openssh';

export interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export interface RemoteProject {
  id: string;
  /** 远端项目根目录（POSIX 绝对路径）。 */
  path: string;
  remoteId: string;
  label: string;
  target: RemoteTarget;
}

/** 工作区的项目树归工作区模块，core 只按 id 查询。 */
export interface Projects {
  /** 项目条目；id 不是项目时返回 null。远程项目的 path 是远端路径。 */
  find(id: string): { name: string; path: string | null } | null;
  /** 本机项目，不含远程项目。 */
  local(): { id: string; name: string; path: string }[];
  /** 条目（项目、远端条目 id 或远端绝对路径）所属的远程项目；本地条目返回 null。 */
  remoteOf(id: string): RemoteProject | null;
}

/** 走宿主的网络栈（系统代理、证书），与界面里的请求表现一致。 */
export interface Network {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** 加密保存的凭据，每一类一个命名空间，互不覆盖。 */
export type SecretNamespace =
  'llm-providers' | 'mail-credentials' | 'canvas-token' | 'shuiyuan-key' | 'mcp-servers';

export interface SecretStore {
  write(namespace: SecretNamespace, plaintext: string): void;
  read(namespace: SecretNamespace): string | null;
  remove(namespace: SecretNamespace): void;
}

/** 后台任务的终态提醒；偏好与系统通知由实现方决定。 */
export interface Notifier {
  notifyRunFinished(sessionId: string, status: 'completed' | 'failed'): void;
}

export interface ClientBroadcaster {
  subscribe(client: ClientHandle): void;
  send(channel: string, ...args: unknown[]): void;
}

export interface ImageCodec {
  /** 生成宽不超过 480 的 data: 缩略图；无法解码或为空图时返回 null。 */
  previewDataUrl(source: string | Buffer): string | null;
}

export interface SavePathOptions {
  title: string;
  defaultPath: string;
  extension: string;
}

/** 桌面专有操作：对话框、系统文件管理器与回收站。core 只处理路径。 */
export interface Desktop {
  pickFiles(owner: ClientHandle): Promise<string[]>;
  pickSavePath(owner: ClientHandle | null, options: SavePathOptions): Promise<string | null>;
  reveal(path: string): void;
  open(path: string): Promise<void>;
  trash(path: string): Promise<void>;
  sendToWindows(channel: string): void;
}

/** 密钥存在但本机无法解密（换机、钥匙串重置）；原文件由实现方保留。 */
export class CredentialDecryptionError extends Error {
  constructor(namespace: SecretNamespace, cause: unknown) {
    super(
      `本机无法解密${SECRET_LABELS[namespace]}，请在设置中重新配置。原加密文件仍保留，重新保存时会自动备份。`,
      { cause },
    );
    this.name = 'CredentialDecryptionError';
  }
}

const SECRET_LABELS: Record<SecretNamespace, string> = {
  'llm-providers': '模型服务配置',
  'mail-credentials': '邮箱凭据',
  'canvas-token': 'Canvas 凭据',
  'shuiyuan-key': '水源凭据',
  'mcp-servers': 'MCP 服务器配置',
};

let ports: HostPorts | null = null;

export function provideHostPorts(implementation: HostPorts): void {
  ports = implementation;
}

export function hostPorts(): HostPorts {
  if (!ports) throw new Error('宿主端口尚未注入');
  return ports;
}
