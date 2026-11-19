// 主进程与桌面宿主之间的端口：agent 只依赖这些接口，Electron 实现在 app 中注入。
import type { Contract, EventPayload } from './protocol/contract';
import type { RemoteTarget } from './remote/transport';

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
  workspaceClient(): ClientHandle | null;
  projects: Projects;
}

export interface Paths {
  userData(): string;
  home(): string;
  documents(): string;
  temp(): string;
  storage(): string;
  bundled(name: BundledResource): string;
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
  exec(sql: string): unknown;
  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): (...args: Args) => Result;
}

export interface RemoteProject {
  id: string;
  path: string;
  remoteId: string;
  label: string;
  target: RemoteTarget;
}

export interface Projects {
  find(id: string): { name: string; path: string | null } | null;
  local(): { id: string; name: string; path: string }[];
  remoteOf(id: string): RemoteProject | null;
}

export interface Network {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** 加密保存的凭据，每一类一个命名空间，互不覆盖；模块的命名空间经 registerSecretLabel 登记。 */
export type SecretNamespace = string;

export interface SecretStore {
  write(namespace: SecretNamespace, plaintext: string): void;
  read(namespace: SecretNamespace): string | null;
  remove(namespace: SecretNamespace): void;
}

export interface Notifier {
  notifyRunFinished(sessionId: string, status: 'completed' | 'failed'): void;
  show(title: string, body: string, onClick?: () => void): void;
}

export interface ClientBroadcaster {
  subscribe(client: ClientHandle): void;
  send(channel: string, ...args: unknown[]): void;
}

export interface ImageCodec {
  previewDataUrl(source: string | Buffer): string | null;
}

export interface SavePathOptions {
  title: string;
  defaultPath: string;
  extension: string;
}

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
      `本机无法解密${secretLabels.get(namespace) ?? '已保存的凭据'}，请在设置中重新配置。原加密文件仍保留，重新保存时会自动备份。`,
      { cause },
    );
    this.name = 'CredentialDecryptionError';
  }
}

const secretLabels = new Map<SecretNamespace, string>([
  ['llm-providers', '模型服务配置'],
  ['mcp-servers', 'MCP 服务器配置'],
]);

export function registerSecretLabel(namespace: SecretNamespace, label: string): void {
  secretLabels.set(namespace, label);
}

let ports: HostPorts | null = null;

export function provideHostPorts(implementation: HostPorts): void {
  ports = implementation;
}

export function hostPorts(): HostPorts {
  if (!ports) throw new Error('宿主端口尚未注入');
  return ports;
}

/** 推送契约事件给订阅过的窗口（docs/adr/0017）。 */
export function emit<C extends Contract, K extends keyof C['events'] & string>(
  contract: C,
  name: K,
  payload: EventPayload<C, K>,
): void {
  hostPorts().broadcaster.send(`${contract.namespace}:${name}`, payload);
}
