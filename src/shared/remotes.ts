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
}
