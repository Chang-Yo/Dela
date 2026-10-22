// 远程连接契约。ssh 调用与私钥路径只存在于主进程；渲染端只拿到连接信息与目录清单。
export interface RemoteConnection {
  id: string;
  label: string;
  /** ssh 的第一个位置参数：`~/.ssh/config` 别名或 `user@host`。 */
  host: string;
  port: number | null;
  /** 私钥文件；null 表示交给 ssh 自己按 config 与 agent 解析。 */
  keyPath: string | null;
  createdAt: string;
}

/** 未保存的连接草稿：向导里边填边测，不必先落库。 */
export interface RemoteDraft {
  label?: string;
  host: string;
  port?: number | null;
  keyPath?: string | null;
}

/** `~/.ssh/config` 里的一台具体主机：新建远程项目时作为候选，选中并连上后才保存为连接。 */
export interface SshConfigHost {
  /** Host 别名，就是交给 ssh 的目的地。 */
  alias: string;
  /** 以下只用于展示，连接时一律交给 ssh 按 config 解析。 */
  hostName: string | null;
  user: string | null;
  port: number | null;
}

export interface RemoteProbe {
  ok: boolean;
  /** 成功时是一行环境摘要，失败时直接展示给用户的原因（主机不可达、认证失败、指纹未确认……）。 */
  message: string;
}

/** 引导 helper 的步骤：与「引导与恢复」的表格一一对应，也是日志区的行标签。 */
export type RemoteSetupStep =
  'probe' | 'upload' | 'verify' | 'start' | 'tunnel' | 'handshake' | 'ready';

/** 一行引导进度：一步一次，成功与失败各报一次，不做百分比（上传本身也没有细粒度回报）。 */
export interface RemoteSetupProgress {
  step: RemoteSetupStep;
  /** 给人看的一行细节：字节数、端口、失败原因。 */
  detail?: string;
  /** 缺省表示「这一步开始了」；true 成功；false 失败。 */
  ok?: boolean;
  /** 只有上传带：已传与总字节数，界面据此画进度条。 */
  bytes?: { sent: number; total: number };
}

/** 连接（引导 helper）的结果：通过才能浏览目录。 */
export interface RemotePrepare {
  ok: boolean;
  /** 失败的原因（SSH 不通，或 helper 在这台服务器上起不来）。 */
  message: string;
  /** 远端主目录：目录选择器从这里起步；失败时为 null。 */
  home: string | null;
}

/** helper 通道状态：connecting 首次引导中，ready 可用，reconnecting 隧道断了正在重建（远端任务照跑），
 *  unavailable 起不来或重连超时（这台服务器的项目暂时不能用）。 */
export type RemoteChannelStatus = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

/** 一条 helper 通道的状态。每个连接各一条通道，送到渲染端的是全部通道的整份快照，
 *  渲染端按目的地对准自己的项目；通道关闭后从快照里消失。 */
export interface RemoteChannelState {
  /** ssh 目的地（host），与连接里的 host 字段一致。 */
  destination: string;
  state: RemoteChannelStatus;
  /** unavailable 时给人看的原因：分类诊断（noexec／只读挂载／SELinux）或原始错误；其余状态为空串。 */
  reason: string;
  /** 进入当前状态的时刻（epoch 毫秒）。 */
  since: number;
}

/** 远端任务（agent 的 bash 调用）的快照：断线期间也在远端继续跑。 */
export interface RemoteTask {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  state: 'running' | 'exited' | 'cancelled' | 'timeout';
  exitCode: number;
  signal?: string;
  /** epoch 毫秒。 */
  startedAt: number;
  durationMs: number;
  /** 已产出的输出字节数。 */
  output: number;
}

/** 远端监听端口（/v1/ports）：归属拿不到（别的用户的进程）时 pid/process 缺省。 */
export interface RemotePortEntry {
  port: number;
  pid?: number;
  process?: string;
}

/** 一条已建立的端口隧道：浏览器从本机回环访问远端端口。 */
export interface RemotePortTunnel {
  remotePort: number;
  localPort: number;
}

/** 端口预览面板的一次快照：清单与已开隧道一起回，面板不用自己记状态。 */
export interface RemotePortsState {
  ports: RemotePortEntry[];
  tunnels: RemotePortTunnel[];
}

export interface RemoteDirectoryEntry {
  name: string;
  /** 远端绝对路径（POSIX）。 */
  path: string;
  directory: boolean;
  size: number | null;
  /** epoch 毫秒；远端未返回时为 null。 */
  modifiedAt: number | null;
}

/** 远端条目在文件树里的身份：项目 id + 远端绝对路径。
 *  只用路径作 id 会让两台连接上的同路径目录串成同一个节点：清单缓存、展开态与选中态都会混。 */
export function remoteNodeId(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

/** 是否在远端项目根目录内（渲染端构造地址时用；主进程会再校验一次）。 */
export function withinRemotePath(root: string, path: string): boolean {
  return path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
}

/** 远端 Markdown 里的相对图片：按 Markdown 所在目录解析成可取字节的地址（dela-resource://remote-raw）。
 *  越界的相对路径与绝对地址原样返回，由渲染端按加载失败处理。 */
export function remoteAssetUrl(
  projectId: string,
  root: string,
  fromPath: string,
  src: string,
): string {
  // 带协议的地址、协议相对地址与页内锚点都不是「远端相对文件」，原样交回。
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return src;
  const segments = fromPath.slice(0, fromPath.lastIndexOf('/')).split('/');
  for (const part of src.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const target = segments.join('/') || '/';
  if (!withinRemotePath(root, target)) return src;
  return `dela-resource://remote-raw/${encodeURIComponent(projectId)}?path=${encodeURIComponent(target)}`;
}

/** 条目 id 是否带项目身份（项目 id 是 UUID，与本地磁盘路径的盘符冒号不会混淆）。 */
const remoteNodeIdPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\/.+)$/i;

/** 解析带项目身份的远端条目 id；本地条目 id（UUID 或磁盘路径）返回 null。 */
export function parseRemoteNodeId(id: string): { projectId: string; path: string } | null {
  const [, projectId, path] = remoteNodeIdPattern.exec(id) ?? [];
  if (!projectId || !path) return null;
  return { projectId, path };
}

export interface RemoteBrowseResult {
  path: string;
  /** 上一级目录；已在根目录时为 null。 */
  parent: string | null;
  /** 只列目录：选择项目目录时不需要文件。 */
  directories: RemoteDirectoryEntry[];
}

export interface RemoteApi {
  list(): Promise<RemoteConnection[]>;
  save(draft: RemoteDraft & { id?: string | null }): Promise<RemoteConnection>;
  remove(id: string): Promise<void>;
  probe(draft: RemoteDraft): Promise<RemoteProbe>;
  /** 目录选择器：列出某个远端目录下的子目录（只列目录，含隐藏目录，由界面决定显示与否）。 */
  browse(draft: RemoteDraft, path: string): Promise<RemoteBrowseResult>;
  /** 目录选择器里在 parent 下新建一层文件夹，返回新目录的完整路径。 */
  mkdir(draft: RemoteDraft, parent: string, name: string): Promise<string>;
  /** 私钥文件选择器：取消返回 null。 */
  pickKey(): Promise<string | null>;
  /** 本机 `~/.ssh/config` 里还没保存为连接的主机。 */
  configHosts(): Promise<SshConfigHost[]>;
  /** 连接：把 helper 引导起来（已连上就直接返回），过程经 onSetupProgress 一行行送达。 */
  prepare(draft: RemoteDraft): Promise<RemotePrepare>;
  onSetupProgress(listener: (progress: RemoteSetupProgress) => void): () => void;
  /** 全部 helper 通道的状态快照：订阅时立刻推一次当前值，之后每次变化再推。 */
  onHelperState(listener: (states: RemoteChannelState[]) => void): () => void;
  /** 这个连接上的远端任务（在跑的与最近结束的）；通道不可用时报错。 */
  tasks(remoteId: string): Promise<RemoteTask[]>;
  cancelTask(remoteId: string, taskId: string): Promise<void>;
  /** 手动重试：通道不可用时立刻重新引导，不等自动重试的间隔。 */
  retry(remoteId: string): Promise<RemoteChannelState>;
}
