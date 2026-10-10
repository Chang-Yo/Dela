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
}

/** 向导「连接」这一步的结果：自检不过就不能继续，helper 起不来只是降级。 */
export interface RemotePrepare {
  /** SSH 自检是否通过（连目录都列不出来时只能停下来改目的地）。 */
  ok: boolean;
  /** 自检失败的原因，或成功时的一行环境摘要。 */
  message: string;
  /** helper 通道是否就绪；false 表示本次会话退回一次性 ssh（功能仍在，见 docs/remote-helper.md）。 */
  helper: boolean;
}

/** helper 通道的降级状态：通道建立失败后 Dela 正在用一次性 ssh。
 *  哪台服务器用不了 helper，就按目的地对准哪台的项目提示；通道恢复后推 null。 */
export interface HelperDegradation {
  /** ssh 目的地（host），与连接里的 host 字段一致。 */
  destination: string;
  /** 给人看的原因：分类诊断（noexec／只读挂载／SELinux）或原始错误。 */
  reason: string;
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
  /** 远端主目录；只有首次（未指定 path）解析时返回，翻页沿用首次结果。 */
  home: string | null;
  /** 目标路径本身是否目录；选项目只能选目录。 */
  directory: boolean;
  /** 只列目录：选择项目目录时不需要文件。 */
  directories: RemoteDirectoryEntry[];
}

export interface RemoteApi {
  list(): Promise<RemoteConnection[]>;
  save(draft: RemoteDraft & { id?: string | null }): Promise<RemoteConnection>;
  remove(id: string): Promise<void>;
  probe(draft: RemoteDraft): Promise<RemoteProbe>;
  /** 目录选择器：path 为 null 时从远端主目录开始。 */
  browse(draft: RemoteDraft, path: string | null): Promise<RemoteBrowseResult>;
  /** 私钥文件选择器：取消返回 null。 */
  pickKey(): Promise<string | null>;
  /** 连接：自检 + 把 helper 真的引导起来，过程经 onSetupProgress 一行行送达。 */
  prepare(draft: RemoteDraft): Promise<RemotePrepare>;
  /** 订阅引导进度；返回退订函数。 */
  onSetupProgress(listener: (progress: RemoteSetupProgress) => void): () => void;
  /** 订阅 helper 降级状态；通道建立失败推原因，恢复或切换后推 null。 */
  onHelperState(listener: (state: HelperDegradation | null) => void): () => void;
}
