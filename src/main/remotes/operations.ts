/**
 * 远程工具：把 Pi 七个内置工具的执行端换到 SSH 远端。
 *
 * read/write/edit/bash/ls/find 复用 Pi 的工具定义（参数 schema、描述、截断与渲染都不动），
 * 只注入 operations；grep 在 Pi 内部固定 spawn 本地 rg，没有 operations 可换，
 * 因此保留它的 schema 与描述、自写 execute 在远端搜索。
 *
 * 关键约束：工具在调用 operations 之前已经用宿主 node:path 解析过参数。
 * 本机实测 cwd=/root/proj 时 `src/a.ts` 会变成 `E:\root\proj\src\a.ts`，
 * 绝对路径 `/tmp/x` 会变成 `\tmp\x`，所以每个路径都必须先过 remotePath 还原。
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { loadPi } from '../agent/pi';
import { discardHelperIfDead, HelperHttpError, helperSession, type HelperSession } from './helper';
import { notifyRemoteChange } from './events';
import { syncRemoteWatch } from './watch';
import {
  exec,
  listDirectory,
  locate,
  readFile,
  shellQuote,
  writeFile,
  type RemoteDirEntry,
  type RemoteTarget,
} from './transport';

/** 通道优先、失败退回一次性 ssh：只用在「重跑一次没有副作用」的操作上。
 *  远端命令一旦可能已经跑过，再发一次会变成重复执行（`git push` 跑两遍），那些调用方自己判。 */
async function withHelper<T>(
  target: RemoteTarget,
  work: (session: HelperSession) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    const session = await helperSession(target);
    if (!session) return await fallback();
    // 通道刚给了这个目标：顺带让 watch 也为它起一条流（每个连接各一条，互不影响）。
    syncRemoteWatch(target);
    return await work(session);
  } catch (error) {
    // helper 用非 2xx 回答的业务结果（路径不存在、参数越界）不是通道故障：
    // 拆通道再走一遍一次性 ssh 只会把一次 404 放大成一次冷启动，还顺带掐断 watch 流。
    if (error instanceof HelperHttpError) throw error;
    console.warn('[remotes] helper 通道调用失败，退回一次性 ssh', error);
    // 通道是多个会话共用的：先探活，只有它真的不通才拆，否则别把别人正在跑的命令一起掐了。
    await discardHelperIfDead(target);
    return fallback();
  }
}

/** 目录清单：helper 通道优先（一次 HTTP，约 60ms），拿不到再退回一次性 ssh（约 300ms）。
 *  远端目录树每展开一层都走这里，这是用户能直接感觉到的延迟。 */
export async function listRemoteDirectory(
  target: RemoteTarget,
  path: string,
): Promise<RemoteDirEntry[]> {
  return withHelper(
    target,
    (session) => session.list(path),
    () => listDirectory(target, path),
  );
}

/** 远端文件的一条 stat。通道可用时走 `/v1/fs/stat`（预览每取一块都要问一次 size/mtime，
 *  列父目录整层太贵）；没有通道时退回父目录清单（一次性 ssh，本来就只有一次往返）。 */
export async function statRemoteFile(target: RemoteTarget, path: string): Promise<RemoteDirEntry> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return withHelper(
    target,
    async (session) => {
      const [stat] = await session.stat([path]);
      if (!stat?.exists) throw new Error(`远端文件不存在：${path}`);
      if (stat.directory) throw new Error(`这是目录，不是文件：${path}`);
      return { name, path, directory: false, size: stat.size, modifiedAt: stat.modifiedAt };
    },
    async () => {
      const cut = path.lastIndexOf('/');
      const entries = await listDirectory(target, cut <= 0 ? '/' : path.slice(0, cut));
      const entry = entries.find((item) => item.name === name);
      if (!entry) throw new Error(`远端文件不存在：${path}`);
      if (entry.directory) throw new Error(`这是目录，不是文件：${path}`);
      return entry;
    },
  );
}

/** 片段读取：预览用。helper 通道直接带 offset/length；没有通道时退回整文件读取再切片
 *  （降级路径，只在 helper 不可用时兜底，大文件这一路会整篇进内存）。 */
export async function readRemoteRange(
  target: RemoteTarget,
  path: string,
  offset: number,
  length: number,
): Promise<Buffer> {
  return withHelper(
    target,
    (session) => session.readFileRange(path, offset, length),
    async () => (await readFile(target, path)).subarray(offset, offset + length),
  );
}

/** 整文件写入：helper 通道一次 PUT（服务端同目录临时文件 + rename，失败不留半个文件），
 *  没有通道时退回一次性 ssh。上传二进制走这里。 */
export async function writeRemoteFile(
  target: RemoteTarget,
  path: string,
  content: Buffer,
): Promise<void> {
  return withHelper(
    target,
    (session) => session.writeFile(path, content),
    () => writeFile(target, path, content),
  );
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

const trimSlash = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

function throughMirror(value: string): string | null {
  const normalized = value.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  let best: { mirror: string; remote: string } | undefined;
  for (const routes of mirrorRoutes.values()) {
    for (const route of routes) {
      const prefix = trimSlash(route.mirror);
      if (lower === prefix.toLowerCase() || lower.startsWith(`${prefix.toLowerCase()}/`)) {
        if (!best || prefix.length > trimSlash(best.mirror).length) best = route;
      }
    }
  }
  return best
    ? `${trimSlash(best.remote)}${normalized.slice(trimSlash(best.mirror).length)}`
    : null;
}

/** 命令正文里的镜像路径也要翻回远端：模型可能直接 `cat <镜像路径>`。
 *  路径分隔符可能是 `/` 或 `\`，Windows 盘符大小写不定，所以整段大小写不敏感。
 *  换掉前缀后，同一段路径里剩下的 `\` 也要转成 `/`——bash 会把 `\` 当转义吃掉。 */
export function mirrorCommandText(command: string): string {
  const routes = [...mirrorRoutes.values()]
    .flat()
    .sort((left, right) => trimSlash(right.mirror).length - trimSlash(left.mirror).length);
  let result = command;
  for (const route of routes) {
    const prefix = trimSlash(route.mirror)
      .split('/')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\\\/]');
    // 尾巴吃到引号或 shell 元字符为止，路径里的空格要一起带上（模型多半会加引号）。
    result = result.replace(
      new RegExp(`${prefix}([^"'|&;()<>\\n]*)`, 'gi'),
      (_match, tail: string) => `${trimSlash(route.remote)}${tail.replace(/\\/g, '/')}`,
    );
  }
  return result;
}

/** 还原远端 POSIX 路径：先翻镜像，再去盘符、反斜杠转正斜杠、合并重复斜杠。 */
export function remotePath(value: string): string {
  const mapped = throughMirror(value);
  let path = (mapped ?? value).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
  path = path.replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

const imageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 目录清单缓存：ls 工具会在 readdir 之后对每个条目再调一次 stat，
 *  逐条往返 SSH 会让一次列目录变成十几秒，这里用刚拉到的清单回答。 */
const LISTING_TTL_MS = 10_000;
/** 单行匹配文本上限（与 Pi 的 grep 一致）。 */
const GREP_MAX_LINE_LENGTH = 500;

/** Pi 的工具定义在参数类型上是不变的，customTools 收的却是 ToolDefinition[]：
 *  这里是纯类型收窄，运行时对象原样传递。 */
const asTool = (definition: unknown): ToolDefinition => definition as ToolDefinition;

/** glob → RegExp：与 Pi 的 find 一致，不含 `/` 的模式补上 `**` 前缀，`*` 不跨目录。
 *  必须一次扫描替换：分步 replace 会把上一步插入的 `.*` 再当成通配符改写掉。 */
function globToRegExp(glob: string): RegExp {
  const pattern = glob.includes('/') ? glob.replace(/^\//, '') : `**/${glob}`;
  const source = pattern.replace(/(\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\])/g, (token) => {
    switch (token) {
      case '**/':
        return '(?:.*/)?';
      case '**':
        return '.*';
      case '*':
        return '[^/]*';
      case '?':
        return '[^/]';
      default:
        return `\\${token}`;
    }
  });
  return new RegExp(`^${source}$`);
}

export function remoteOperations(target: RemoteTarget) {
  const listings = new Map<string, { at: number; directories: Map<string, boolean> }>();

  /** helper 通道：拿不到就返回 null，调用方退回一次性 ssh。只有「重跑一次没有副作用」的
   *  操作才配回退；bash 的命令可能已经跑过，它自己判（见 bash.exec）。 */
  const throughHelper = <T>(
    work: (session: HelperSession) => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> => withHelper(target, work, fallback);

  const cacheListing = (path: string, entries: { name: string; directory: boolean }[]) => {
    if (listings.size > 64) listings.clear();
    listings.set(path, {
      at: Date.now(),
      directories: new Map(entries.map((entry) => [entry.name, entry.directory])),
    });
  };

  const assertReadable = async (absolutePath: string) => {
    const path = remotePath(absolutePath);
    const result = await exec(target, `test -r ${shellQuote(path)}`, { timeoutMs: 20_000 });
    if (result.code !== 0) throw new Error(`文件不存在或不可读：${path}`);
  };

  const read = {
    readFile: (absolutePath: string) => {
      const path = remotePath(absolutePath);
      return throughHelper(
        (session) => session.readFile(path),
        () => readFile(target, path),
      );
    },
    access: assertReadable,
    detectImageMimeType: (absolutePath: string) => {
      const match = /\.[A-Za-z0-9]+$/.exec(remotePath(absolutePath));
      return Promise.resolve(match ? (imageMime[match[0].toLowerCase()] ?? null) : null);
    },
  };

  const write = {
    writeFile: (absolutePath: string, content: string) => {
      const path = remotePath(absolutePath);
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      // 写完就通知目录树：远端没有文件监听，不推这一次，新文件要等用户收起再展开才出现。
      const written = throughHelper(
        async (session) => {
          // helper 的写入只管落盘（不替调用方建目录），这里补上 Pi 期望的 mkdir -p。
          await session.exec(`mkdir -p -- ${shellQuote(parent)}`, { cwd: '/' });
          await session.writeFile(path, content);
        },
        () => writeFile(target, path, content),
      );
      return written.then((result) => {
        notifyRemoteChange(parent);
        return result;
      });
    },
    // Pi 在 writeFile 之前会单独调一次 mkdir；transport.writeFile 自己就带着 mkdir -p，
    // 再跑一趟 ssh 只是白付一次握手。
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
      // 命令正文里可能直接写着镜像路径（模型从技能的 <location> 抄来的），一并翻回远端。
      const remoteCommand = mirrorCommandText(command);
      // Pi 传进来的是秒，两边的传输都收毫秒。
      const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
      // 登录 shell：远端命令要用用户自己的 PATH（nvm、conda 等都在 profile 里）。
      const exported = Object.entries(forwarded).map(
        ([key, value]) => `export ${key}=${shellQuote(value)}`,
      );

      const session = await helperSession(target);
      if (session) {
        try {
          const result = await session.exec(remoteCommand, {
            cwd: remoteCwd,
            signal: options.signal,
            timeoutMs,
            env: forwarded,
            onData: options.onData,
          });
          if (result.discarded > 0)
            options.onData(
              Buffer.from(`\n[远端输出过大，已丢弃 ${result.discarded} 字节]\n`, 'utf8'),
            );
          // 命令可能建了目录或改了文件（mkdir / git clone / npm install 都走 bash）：
          // 以 cwd 为界让目录树重读，命令是只读的也只是多一次很便宜的清单请求。
          notifyRemoteChange(remoteCwd);
          if (options.signal?.aborted) throw new Error('aborted');
          if (result.state === 'timeout') throw new Error(`timeout:${options.timeout ?? 120}`);
          return { exitCode: result.code };
        } catch (error) {
          // 不退回 ssh：命令可能已经在远端跑过，重发等于重复执行。
          // 但要先探活再决定拆不拆通道——取消一条命令不该掐断别的会话的通道。
          await discardHelperIfDead(target);
          throw error;
        }
      }

      const inner = [...exported, `cd ${shellQuote(remoteCwd)}`, remoteCommand].join(' && ');
      const result = await exec(target, `exec bash -lc ${shellQuote(inner)}`, {
        signal: options.signal,
        timeoutMs,
        onData: options.onData,
        onStderr: options.onData,
        collect: false,
      });
      notifyRemoteChange(remoteCwd);
      if (options.signal?.aborted) throw new Error('aborted');
      if (result.code === 124) throw new Error(`timeout:${options.timeout ?? 120}`);
      return { exitCode: result.code };
    },
  };

  const list = async (path: string) => {
    const entries = await listDirectory(target, path);
    cacheListing(path, entries);
    return entries;
  };

  const stat = async (absolutePath: string) => {
    const path = remotePath(absolutePath);
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    const name = path.slice(path.lastIndexOf('/') + 1);
    const cached = listings.get(parent);
    if (cached && Date.now() - cached.at < LISTING_TTL_MS) {
      const directory = cached.directories.get(name);
      if (directory !== undefined) return { isDirectory: () => directory };
    }
    const found = await locate(target, path);
    if (found.kind === 'missing') throw new Error(`文件不存在：${path}`);
    return { isDirectory: () => found.directory };
  };

  const ls = {
    exists: async (absolutePath: string) => {
      const result = await exec(target, `test -e ${shellQuote(remotePath(absolutePath))}`, {
        timeoutMs: 20_000,
      });
      return result.code === 0;
    },
    stat,
    readdir: async (absolutePath: string) =>
      (await list(remotePath(absolutePath))).map((entry) => entry.name),
  };

  const glob = async (
    pattern: string,
    searchPath: string,
    options: { ignore: string[]; limit: number },
  ) => {
    const path = remotePath(searchPath);
    // 第一行报出用的是哪个后端：rg 已经按 glob 过滤，find 只做了粗筛要再筛一遍。
    const script = [
      `cd ${shellQuote(path)} 2>/dev/null || exit 3`,
      `if command -v rg >/dev/null 2>&1; then`,
      `printf 'rg\\n'`,
      `rg --files --hidden -g ${shellQuote(pattern)} -g '!.git' -g '!node_modules' 2>/dev/null | head -n ${options.limit}`,
      `else`,
      `printf 'find\\n'`,
      `find . -type f -not -path './.git/*' -not -path '*/node_modules/*' 2>/dev/null | head -n 8000`,
      `fi`,
    ].join('\n');
    const result = await exec(target, script, { timeoutMs: 60_000 });
    if (result.code === 3) throw new Error(`Path not found: ${path}`);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `远端命令退出码 ${result.code}`);
    const [backend = '', ...lines] = result.stdout.toString().split('\n');
    const files = lines.map((line) => line.replace(/^\.\//, '').trim()).filter(Boolean);
    const matched =
      backend === 'rg' ? files : files.filter((file) => globToRegExp(pattern).test(file));
    return matched.slice(0, options.limit);
  };

  const find = {
    exists: ls.exists,
    glob,
  };

  return { read, write, edit: { ...read, writeFile: write.writeFile }, bash, ls, find };
}

/** 远端 grep：优先 ripgrep，无 rg 时退到 grep -rn。
 *  Pi 的 grep 工具没有 operations 注入点，所以这里保留它的 schema 与描述、只换 execute。 */
export async function remoteGrepTool(cwd: string, target: RemoteTarget): Promise<ToolDefinition> {
  const pi = await loadPi();
  const base = pi.createGrepToolDefinition(cwd);
  return asTool({
    ...base,
    execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      };
      const searchPath = remotePath(params.path && params.path !== '.' ? params.path : cwd);
      const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
      const context = params.context ? Math.max(1, Math.min(params.context, 20)) : 0;
      const glob = params.glob?.replace(/^\*\*\//, '');
      const rgFlags = [
        '--line-number',
        '--no-heading',
        '--color=never',
        '--glob !.git',
        '--glob !node_modules',
        params.ignoreCase ? '--ignore-case' : '',
        params.literal ? '--fixed-strings' : '',
        context ? `--context ${context}` : '',
        glob ? `--glob ${shellQuote(glob)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const grepFlags = [
        '-rnH',
        '-I',
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        params.ignoreCase ? '-i' : '',
        params.literal ? '-F' : '',
        context ? `-C ${context}` : '',
        glob ? `--include=${shellQuote(glob)}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const needle = shellQuote(params.pattern);
      const script = [
        `cd ${shellQuote(searchPath)} 2>/dev/null || exit 3`,
        `if command -v rg >/dev/null 2>&1; then`,
        `rg ${rgFlags} -e ${needle} . 2>/dev/null`,
        `else`,
        `grep ${grepFlags} -e ${needle} . 2>/dev/null`,
        `fi | head -n ${limit * 4 + 20}`,
      ].join('\n');
      const result = await exec(target, script, { signal, timeoutMs: 120_000 });
      if (result.code === 3) throw new Error(`Path not found: ${searchPath}`);
      if (result.code !== 0 && !result.stdout.length)
        throw new Error(result.stderr.trim() || `远端搜索失败（退出码 ${result.code}）`);
      const lines = result.stdout.toString().split('\n').filter(Boolean);
      const output: string[] = [];
      let matches = 0;
      for (const line of lines) {
        const match = /^(.*?):(\d+):(.*)$/.exec(line);
        const context = /^(.*?)-(\d+)-(.*)$/.exec(line);
        if (match) {
          if (matches >= limit) break;
          matches += 1;
          const truncated = pi.truncateLine(match[3]!, GREP_MAX_LINE_LENGTH);
          output.push(`${match[1]!.replace(/^\.\//, '')}:${match[2]}: ${truncated.text}`);
        } else if (context) {
          output.push(`${context[1]!.replace(/^\.\//, '')}-${context[2]}- ${context[3]}`);
        } else if (line !== '--') {
          output.push(line);
        } else {
          output.push('--');
        }
      }
      if (!output.length)
        return {
          content: [{ type: 'text' as const, text: 'No matches found' }],
          details: undefined,
        };
      const truncated = pi.truncateHead(output.join('\n'), {
        maxLines: pi.DEFAULT_MAX_LINES,
        maxBytes: pi.DEFAULT_MAX_BYTES,
      });
      const text = truncated.truncated ? `${truncated.content}\n\n[输出已截断]` : truncated.content;
      return { content: [{ type: 'text' as const, text }], details: undefined };
    },
  });
}

/** 七个工具的远程版本：名字与内置完全一致，Pi 按名字覆盖内置定义。 */
export async function remoteTools(cwd: string, target: RemoteTarget): Promise<ToolDefinition[]> {
  // Pi 是纯 ESM：主进程 CJS 产物只能动态 import，不能在文件顶部静态引入。
  const pi = await loadPi();
  const operations = remoteOperations(target);
  return [
    pi.createReadToolDefinition(cwd, { operations: operations.read }),
    pi.createWriteToolDefinition(cwd, { operations: operations.write }),
    pi.createEditToolDefinition(cwd, { operations: operations.edit }),
    pi.createBashToolDefinition(cwd, { operations: operations.bash }),
    pi.createLsToolDefinition(cwd, { operations: operations.ls }),
    pi.createFindToolDefinition(cwd, { operations: operations.find }),
    await remoteGrepTool(cwd, target),
  ].map(asTool);
}
