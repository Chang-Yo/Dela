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
import { closeHelper, helperSession, type HelperSession } from './helper';
import {
  exec,
  listDirectory,
  locate,
  readFile,
  shellQuote,
  writeFile,
  type RemoteTarget,
} from './transport';

/** 还原远端 POSIX 路径：去盘符、反斜杠转正斜杠、合并重复斜杠。 */
export function remotePath(value: string): string {
  let path = value.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
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

  /** helper 通道：拿不到就返回 null，调用方退回一次性 ssh。
   *  只在「读」和「写」这类重复执行无副作用的操作上回退：远端命令一旦可能已经跑过，
   *  再发一次会变成重复执行（`git push` 跑两遍），所以 bash 走通道失败就直接报错。 */
  const throughHelper = async <T>(
    work: (session: HelperSession) => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> => {
    try {
      const session = await helperSession(target);
      if (!session) return await fallback();
      return await work(session);
    } catch (error) {
      console.warn('[remotes] helper 通道调用失败，退回一次性 ssh', error);
      await closeHelper();
      return fallback();
    }
  };

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
      return throughHelper(
        async (session) => {
          // helper 的写入只管落盘（不替调用方建目录），这里补上 Pi 期望的 mkdir -p。
          const parent = path.slice(0, path.lastIndexOf('/')) || '/';
          await session.exec(`mkdir -p -- ${shellQuote(parent)}`, { cwd: '/' });
          await session.writeFile(path, content);
        },
        () => writeFile(target, path, content),
      );
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
      // Pi 传进来的是秒，两边的传输都收毫秒。
      const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
      // 登录 shell：远端命令要用用户自己的 PATH（nvm、conda 等都在 profile 里）。
      const exported = Object.entries(forwarded).map(
        ([key, value]) => `export ${key}=${shellQuote(value)}`,
      );

      const session = await helperSession(target);
      if (session) {
        try {
          const result = await session.exec(command, {
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
          if (options.signal?.aborted) throw new Error('aborted');
          if (result.state === 'timeout') throw new Error(`timeout:${options.timeout ?? 120}`);
          return { exitCode: result.code };
        } catch (error) {
          // 不退回 ssh：命令可能已经在远端跑过，重发等于重复执行。
          await closeHelper();
          throw error;
        }
      }

      const inner = [...exported, `cd ${shellQuote(remoteCwd)}`, command].join(' && ');
      const result = await exec(target, `exec bash -lc ${shellQuote(inner)}`, {
        signal: options.signal,
        timeoutMs,
        onData: options.onData,
        onStderr: options.onData,
        collect: false,
      });
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
