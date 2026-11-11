/**
 * 远程执行后端：文件读写、命令、搜索与后台命令都走远端 helper。本模块不认识 Pi 与 Agent，
 * 工具适配在 agent/remote-tools。helper 不可用时直接报错（带原因），不退回一次性 ssh。
 * 关键约束：参数已被宿主 node:path 解析成 Windows 形态（`src/a.ts` → `E:\root\proj\src\a.ts`），
 * 每个路径都必须先过 remotePath 还原。
 */
import { randomBytes } from 'node:crypto';
import {
  helperSession,
  type HelperLocation,
  type HelperSearchRequest,
  type HelperSession,
} from './helper';
import { notifyRemoteChange } from './events';
import { syncRemoteWatch } from './watch';
import { shellQuote, type RemoteDirEntry, type RemoteTarget } from './transport';

/** 会话入口：顺带让这个目标的 watch 流起来（每个连接各一条，互不影响）。 */
function session(target: RemoteTarget): HelperSession {
  syncRemoteWatch(target);
  return helperSession(target);
}

/** 目录清单：远端目录树每展开一层都走这里（一次 HTTP，约 30ms）。 */
export function listRemoteDirectory(target: RemoteTarget, path: string): Promise<RemoteDirEntry[]> {
  return session(target).list(path);
}

/** 远端文件的一条 stat：预览每取一块都要问一次 size/mtime。 */
export async function statRemoteFile(target: RemoteTarget, path: string): Promise<RemoteDirEntry> {
  const [stat] = await session(target).stat([path]);
  if (!stat?.exists) throw new Error(`远端文件不存在：${path}`);
  if (stat.directory) throw new Error(`这是目录，不是文件：${path}`);
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { name, directory: false, size: stat.size, modifiedAt: stat.modifiedAt };
}

/** 片段读取：预览与分块下载用，只把请求的那一段拉回本地。 */
export function readRemoteRange(
  target: RemoteTarget,
  path: string,
  offset: number,
  length: number,
): Promise<Buffer> {
  return session(target).readFileRange(path, offset, length);
}

/** 整文件写入：helper 侧同目录临时文件 + rename，缺失的父目录一并建好。 */
export function writeRemoteFile(
  target: RemoteTarget,
  path: string,
  content: Buffer,
): Promise<void> {
  return session(target).writeFile(path, content);
}

/** 建一层目录：helper 没有单独的 mkdir 接口，走 exec；不加 -p，同名已存在时直接报错。 */
export async function makeRemoteDirectory(target: RemoteTarget, path: string): Promise<void> {
  const chunks: Buffer[] = [];
  const result = await session(target).exec(`mkdir -- ${shellQuote(path)}`, {
    cwd: '/',
    timeoutMs: 15_000,
    onData: (chunk) => chunks.push(chunk),
  });
  if (result.code !== 0)
    throw new Error(Buffer.concat(chunks).toString('utf8').trim() || `无法创建目录 ${path}`);
  notifyRemoteChange(parentOf(path));
}

/** 一次请求回答「存在吗、是目录吗、里面有什么」：向导的目录选择器与导入项目用。 */
export function locateRemote(target: RemoteTarget, path: string): Promise<HelperLocation> {
  return session(target).locate(path);
}

/** 远端仓库文件清单（@ 候选）：等价于 `rg --files`，limit 下推到 helper。 */
export async function remoteFileIndex(
  target: RemoteTarget,
  path: string,
  limit: number,
): Promise<string[]> {
  return (await session(target).glob(path, '**', limit)).files;
}

/**
 * 上下文镜像路由：镜像里的路径要先翻译回远端路径，再做常规归一化。
 *
 * 远端 skills 与 AGENTS.md 必须落到本地文件，Pi 自己才读得到（`/skill:name` 展开是本地
 * `readFileSync(skill.filePath)`）。于是远端内容镜像到本地，模型拿着镜像路径去 read/bash，
 * 这里把它翻回远端真身。按项目 key 记路由：不同项目的镜像可以并存，最长前缀优先。
 */
const mirrorRoutes = new Map<string, { mirror: string; remote: string }[]>();

/** 记下一个项目的镜像路由（同 key 覆盖，空数组即撤销）。mirror/remote 都是目录前缀。 */
export function setContextMirrors(key: string, routes: { mirror: string; remote: string }[]): void {
  if (routes.length === 0) mirrorRoutes.delete(key);
  else mirrorRoutes.set(key, routes);
}

const windowsPath = (value: string) => /^(?:[a-z]:[\\/]|\\)/i.test(value);
const trimSlash = (value: string) =>
  (windowsPath(value) ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '');

function throughMirror(value: string): string | null {
  const normalized = windowsPath(value) ? value.replace(/\\/g, '/') : value;
  let best: { mirror: string; remote: string } | undefined;
  for (const routes of mirrorRoutes.values()) {
    for (const route of routes) {
      const windows = windowsPath(route.mirror);
      const prefix = windows ? trimSlash(route.mirror).toLowerCase() : trimSlash(route.mirror);
      const candidate = windows ? normalized.toLowerCase() : normalized;
      if (candidate === prefix || candidate.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > trimSlash(best.mirror).length) best = route;
      }
    }
  }
  return best
    ? `${trimSlash(best.remote)}${normalized.slice(trimSlash(best.mirror).length)}`
    : null;
}

/** 命令正文里的镜像路径也要翻回远端：模型可能直接 `cat <镜像路径>`。
 *  Windows 镜像兼容两种分隔符及大小写；POSIX 镜像保留大小写和文件名里的反斜杠。 */
export function mirrorCommandText(command: string): string {
  const routes = [...mirrorRoutes.values()]
    .flat()
    .sort((left, right) => trimSlash(right.mirror).length - trimSlash(left.mirror).length);
  let result = command;
  for (const route of routes) {
    const windows = windowsPath(route.mirror);
    const separator = windows ? '[\\\\/]' : '/';
    const prefix = trimSlash(route.mirror)
      .split('/')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(separator);
    // 尾巴吃到引号或 shell 元字符为止，路径里的空格要一起带上（模型多半会加引号）。
    result = result.replace(
      new RegExp(
        `${prefix}(?=${separator}|[\\s"'|&;()<>]|$)([^"'|&;()<>\\n]*)`,
        windows ? 'gi' : 'g',
      ),
      (_match, tail: string) =>
        `${trimSlash(route.remote)}${windows ? tail.replace(/\\/g, '/') : tail}`,
    );
  }
  return result;
}

/** 还原远端 POSIX 路径：翻镜像，撤销 Windows 宿主的盘符/分隔符改写，合并重复斜杠。 */
export function remotePath(value: string): string {
  const mapped = throughMirror(value);
  let path =
    mapped ?? (windowsPath(value) ? value.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') : value);
  path = path.replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

export interface RemoteRunOutcome {
  status: 'completed' | 'failed' | 'stopped';
  exitCode?: number | null;
  error?: string;
}

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 目录清单缓存：ls 工具会在 readdir 之后对每个条目再调一次 stat，用刚拉到的清单回答。 */
const LISTING_TTL_MS = 10_000;

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

export type RemoteBackend = ReturnType<typeof remoteBackend>;

export function remoteBackend(target: RemoteTarget) {
  const listings = new Map<string, { at: number; directories: Map<string, boolean> }>();
  const remote = () => session(target);

  const cacheListing = (path: string, entries: { name: string; directory: boolean }[]) => {
    if (listings.size > 64) listings.clear();
    listings.set(path, {
      at: Date.now(),
      directories: new Map(entries.map((entry) => [entry.name, entry.directory])),
    });
  };

  const statOne = async (path: string) => (await remote().stat([path]))[0];

  const read = {
    readFile: (absolutePath: string) => remote().readFile(remotePath(absolutePath)),
    access: async (absolutePath: string) => {
      const path = remotePath(absolutePath);
      const stat = await statOne(path);
      if (!stat?.exists || !stat.readable) throw new Error(`文件不存在或不可读：${path}`);
    },
    detectImageMimeType: (absolutePath: string) => {
      const match = /\.[A-Za-z0-9]+$/.exec(remotePath(absolutePath));
      return Promise.resolve(match ? (imageMime[match[0].toLowerCase()] ?? null) : null);
    },
  };

  const write = {
    writeFile: async (absolutePath: string, content: string) => {
      const path = remotePath(absolutePath);
      await remote().writeFile(path, content);
      // 写完就通知目录树：watch 只盯展开的目录，新建的子目录要靠这一下才出现。
      notifyRemoteChange(parentOf(path));
    },
    // Pi 在 writeFile 之前会单独调一次 mkdir；helper 的写入自己就建父目录。
    mkdir: async (dir: string) => {
      void dir;
    },
  };

  const bash = {
    exec: async (
      command: string,
      cwd: string,
      options: {
        onData: (data: Buffer) => void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
      },
    ) => {
      // 只转发 Pi 的 PI_* 会话变量：把宿主整个环境变量搬到远端既无必要，也会外泄本地信息。
      const forwarded = Object.fromEntries(
        Object.entries(options.env ?? {})
          .filter(([key]) => key.startsWith('PI_'))
          .map(([key, value]) => [key, String(value)]),
      );
      const remoteCwd = remotePath(cwd);
      const result = await remote().exec(
        // 命令正文里可能直接写着镜像路径（模型从技能的 <location> 抄来的），一并翻回远端。
        mirrorCommandText(command),
        {
          cwd: remoteCwd,
          signal: options.signal,
          // Pi 传进来的是秒，helper 收毫秒。
          timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
          env: forwarded,
          onData: options.onData,
        },
      );
      if (result.lost > 0)
        options.onData(Buffer.from(`\n[连接中断期间有 ${result.lost} 字节输出未能接回]\n`, 'utf8'));
      // 命令可能建了目录或改了文件（mkdir / git clone / npm install 都走 bash）：
      // 以 cwd 为界让目录树重读，命令是只读的也只是多一次很便宜的清单请求。
      notifyRemoteChange(remoteCwd);
      if (options.signal?.aborted) throw new Error('aborted');
      if (result.state === 'timeout') throw new Error(`timeout:${options.timeout ?? 120}`);
      return { exitCode: result.code };
    },
  };

  const stat = async (absolutePath: string) => {
    const path = remotePath(absolutePath);
    const name = path.slice(path.lastIndexOf('/') + 1);
    const cached = listings.get(parentOf(path));
    if (cached && Date.now() - cached.at < LISTING_TTL_MS) {
      const directory = cached.directories.get(name);
      if (directory !== undefined) return { isDirectory: () => directory };
    }
    const found = await statOne(path);
    if (!found?.exists) throw new Error(`文件不存在：${path}`);
    return { isDirectory: () => found.directory };
  };

  const ls = {
    exists: async (absolutePath: string) =>
      Boolean((await statOne(remotePath(absolutePath)))?.exists),
    stat,
    readdir: async (absolutePath: string) => {
      const path = remotePath(absolutePath);
      const entries = await remote().list(path);
      cacheListing(path, entries);
      return entries.map((entry) => entry.name);
    },
  };

  const find = {
    exists: ls.exists,
    glob: async (
      pattern: string,
      searchPath: string,
      options: { ignore: string[]; limit: number },
    ) => (await remote().glob(remotePath(searchPath), pattern, options.limit)).files,
  };

  /** 结构化搜索：有 rg 用 rg，没有用 Go 遍历。 */
  const search = (request: HelperSearchRequest, signal?: AbortSignal) =>
    remote().search({ ...request, path: remotePath(request.path) }, signal);

  /**
   * 后台命令。signal 不交给 exec：停止时显式取消，等 helper 报回结束才返回，
   * 退出应用时据此等到取消送达再关隧道，远端不会留下没人管的进程。
   */
  const runInBackground = async (
    command: string,
    cwd: string,
    options: { signal: AbortSignal; timeout?: number; onData: (chunk: Buffer) => void },
  ): Promise<RemoteRunOutcome> => {
    const { signal, timeout, onData } = options;
    const helper = remote();
    const id = randomBytes(12).toString('hex');
    const cancel = () => void helper.cancelTask(id).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await helper.exec(mirrorCommandText(command), {
        id,
        cwd,
        timeoutMs: timeout ? timeout * 1000 : undefined,
        onData,
      });
      if (result.lost > 0)
        onData(Buffer.from(`\n[连接中断期间有 ${result.lost} 字节输出未能接回]\n`, 'utf8'));
      notifyRemoteChange(cwd);
      if (result.state === 'timeout') return { status: 'failed', error: `超时（${timeout} 秒）` };
      if (result.state === 'cancelled') return { status: 'stopped' };
      return { status: result.code === 0 ? 'completed' : 'failed', exitCode: result.code };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };

  return {
    read,
    write,
    edit: { ...read, writeFile: write.writeFile },
    bash,
    ls,
    find,
    search,
    runInBackground,
  };
}
