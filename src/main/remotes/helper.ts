/**
 * 远端 helper 通道：把「一次调用一次 SSH 握手」换成一条常驻通道。
 *
 * Windows OpenSSH 没有 ControlMaster，每调一次工具都要重新握手（实测冷启 4.2 秒）；
 * helper 让这条握手被复用，并补上 shell 命令给不了的能力：片段读取、二进制原子写、
 * 服务端哈希、可取消/可流式的长任务。上传、校验、启动、隧道、握手与心跳都在这里完成，
 * 调用方只看到 readFile / writeFile / exec。
 *
 * 任何一步不成立（缺产物、架构不符、远程不许执行、启动失败、隧道不通）都返回 null，
 * 调用方退回一次性 ssh —— 降级路径必须始终可用。
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { app } from 'electron';
import type { RemoteSetupProgress } from '../../shared/remotes';
import {
  exec,
  locateSsh,
  shellQuote,
  sshBaseArguments,
  targetKey,
  type RemoteDirEntry,
  type RemoteTarget,
} from './transport';

/** 必须与 helper/main.go 的 helperVersion 一致：不匹配说明远端跑的不是这一版产物。 */
export const HELPER_VERSION = '0.2.0';
const PROTOCOL_VERSION = 1;
/** 客户端每 30 秒发一次心跳，helper 连续 5 分钟收不到就退出并终止在跑的任务。 */
const HEARTBEAT_MS = 30_000;
const IDLE_TIMEOUT = '300s';
const BOOTSTRAP_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 120_000;
const TUNNEL_READY_MS = 5_000;
const STARTUP_WAIT_MS = 20_000;
/** exec 的客户端兜底：比 helper 自己的超时多留一点，正常都由 helper 先判定。 */
const EXEC_GRACE_MS = 5_000;
/** watch 流没有事件多久算「隧道半死」：正常心跳是 30 秒一次，5 分钟足够宽松。 */
const WATCH_IDLE_MS = 300_000;

/** helper 推回来的目录事件：change 是「这几层要重读」，reset 是「丢过事件，整片重读」。 */
export type WatchEvent =
  { type: 'change'; id: string; paths: string[] } | { type: 'reset'; id: string; reason: string };

/** 远端架构 → 产物名里的 GOARCH。helper 只有 Linux 版本，其它一律降级。 */
function helperArch(machine: string): 'amd64' | 'arm64' | null {
  if (machine === 'x86_64' || machine === 'amd64') return 'amd64';
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64';
  return null;
}

/** 本地产物路径：开发时在 vendor/，打包后在 resources/。找不到就降级。 */
export function helperArtifact(arch: string): string | null {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'dela-helper')
    : join(app.getAppPath(), 'vendor', 'dela-helper');
  const path = join(root, `dela-helper-linux-${arch}`);
  return existsSync(path) ? path : null;
}

/** 远端目录按「版本-sha8」分家：换版本换目录，旧目录留着（每版一个，便于回退，不自动清理）。 */
export function helperRemoteDir(digest: string): string {
  return `$HOME/.dela/helper/${HELPER_VERSION}-${digest.slice(0, 8)}`;
}

/** 隧道参数：与一次性调用的连接参数同源，只多一个 -L 与 -N。 */
export function tunnelArguments(
  target: RemoteTarget,
  localPort: number,
  remotePort: number,
): string[] {
  return [
    ...sshBaseArguments(target),
    '-o',
    'ExitOnForwardFailure=yes',
    '-N',
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    target.host,
  ];
}

export interface HelperExecOptions {
  cwd: string;
  signal?: AbortSignal;
  /** 毫秒；由调用方换算，与 transport.exec 一致。 */
  timeoutMs?: number;
  env?: Record<string, string>;
  onData?: (chunk: Buffer) => void;
}

export interface HelperExecResult {
  code: number;
  state: 'exited' | 'cancelled' | 'timeout';
  discarded: number;
}

/** helper 的 stat 结果；路径不存在时 exists 为 false，其余字段为零值。 */
export interface HelperStat {
  path: string;
  exists: boolean;
  directory: boolean;
  size: number;
  modifiedAt: number;
}

export interface HelperSession {
  target: RemoteTarget;
  /** 隧道本地端口，仅用于诊断展示。 */
  port: number;
  readFile(path: string, signal?: AbortSignal): Promise<Buffer>;
  /** 片段读取（预览大文件用）：只把请求的那一段拉回本地，不整篇进内存。 */
  readFileRange(
    path: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  writeFile(path: string, content: Buffer | string): Promise<void>;
  /** 目录清单（helper 的 `/v1/fs/list`）：一次 HTTP，不必为列一层付一次 ssh 握手。 */
  list(path: string, signal?: AbortSignal): Promise<RemoteDirEntry[]>;
  /** 批量 stat（helper 的 `/v1/fs/stat`）：预览按 Range 取字节时每块都要 size/mtime，列父目录太贵。 */
  stat(paths: string[], signal?: AbortSignal): Promise<HelperStat[]>;
  /** 替换某个 id 的目录监视集合（只监视这些目录本身，不递归）。 */
  setWatch(id: string, paths: string[]): Promise<{ watching: number; skipped: string[] }>;
  clearWatch(id: string): Promise<void>;
  /** 目录事件流：resolve 表示流结束（通道断/helper 退出），由调用方决定是否重连。 */
  watchEvents(onEvent: (event: WatchEvent) => void, signal?: AbortSignal): Promise<void>;
  exec(command: string, options: HelperExecOptions): Promise<HelperExecResult>;
}

function sha256Of(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('未能分配到本地端口'))));
    });
  });
}

/** 隧道端口由 ssh 绑定，连得上不代表远端已在听；真正的就绪判断是随后的握手。 */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('隧道未就绪'));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

interface HttpResponse {
  status: number;
  body: Buffer;
}

function sendRequest(
  port: number,
  token: string,
  method: string,
  path: string,
  options: { body?: Buffer | string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    // 一次请求有三个可能落定的地方（request 出错、响应读完、响应中途断掉）。
    // 定时器挂在 request 的 close 上，所以响应开始之后必须由 response 侧落定：
    // 否则隧道半死（响应头到了、正文没读完）时这个 Promise 既不 resolve 也不 reject。
    let settled = false;
    let responded = false;
    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = (error?: Error, value?: HttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (error) reject(error);
      else resolve(value!);
    };
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined
            ? {}
            : { 'Content-Length': Buffer.byteLength(options.body) }),
        },
      },
      (response) => {
        responded = true;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          settle(undefined, { status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', (error: Error) => settle(error));
        response.on('close', () => settle(new Error('helper 连接中断')));
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error('请求超时')),
      options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const onAbort = () => request.destroy(new Error('aborted'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error: Error) => settle(error));
    request.on('close', () => {
      // 还没拿到响应就关了：这就是连接中断，不能只清定时器（那会让调用方永远等）。
      if (!responded) settle(new Error('helper 连接中断'));
      else clearTimeout(timer);
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/** helper 用非 2xx 回答了一个业务问题（路径不存在、参数越界）：这是结果，不是通道故障。 */
export class HelperHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HelperHttpError';
  }
}

/** 非 2xx 一律带上远端给的原因：它的错误文案比 HTTP 状态码有用。 */
function assertOk(response: HttpResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) return;
  let detail = response.body.toString().trim();
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // 不是 JSON 就原样带上
  }
  throw new HelperHttpError(
    `${what}失败（HTTP ${response.status}）：${detail.slice(0, 300)}`,
    response.status,
  );
}

async function jsonRequest<T>(
  port: number,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await sendRequest(port, token, method, path, { body: payload, signal });
  assertOk(response, path);
  return JSON.parse(response.body.toString()) as T;
}

/** 远端有没有这一版产物：sha256 一致就跳过上传，否则整份重传并复核。 */
async function ensureArtifact(
  target: RemoteTarget,
  dir: string,
  artifact: string,
  digest: string,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<void> {
  const probe = await exec(
    target,
    [
      `dir=${dir}`,
      'mkdir -p "$dir"',
      'chmod 700 "$dir"',
      `if [ -x "$dir/dela-helper" ] && [ "$(sha256sum "$dir/dela-helper" 2>/dev/null | cut -d" " -f1)" = "${digest}" ]; then printf READY; else printf NEED; fi`,
    ].join('\n'),
    { timeoutMs: BOOTSTRAP_TIMEOUT_MS },
  );
  if (probe.code !== 0) {
    const detail = probe.stderr.trim() || '探测远端 helper 失败';
    onProgress?.({ step: 'verify', ok: false, detail });
    throw new Error(detail);
  }
  if (probe.stdout.toString().trim() === 'READY') {
    onProgress?.({ step: 'verify', ok: true, detail: '远端已有这一版产物，跳过上传' });
    return;
  }

  // base64 走 ssh 的 stdin：二进制内容不经过 shell 解析，落盘后再核一次 sha256。
  // 上传进度只报「开始 / 完成（字节数）/ 校验」三档：ssh 的 stdin 写没有可用的进度回调，
  // 为进度条去改上传协议得不偿失。
  const body = readFileSync(artifact);
  onProgress?.({ step: 'upload', detail: `开始上传 ${body.length} 字节` });
  const upload = await exec(
    target,
    [
      'set -e',
      `dir=${dir}`,
      'tmp="$dir/.upload-$$"',
      'base64 -d > "$tmp"',
      'chmod 700 "$tmp"',
      'mv -f "$tmp" "$dir/dela-helper"',
      'sha256sum "$dir/dela-helper" | cut -d" " -f1',
    ].join('\n'),
    { stdin: `${body.toString('base64')}\n`, timeoutMs: UPLOAD_TIMEOUT_MS },
  );
  const uploaded = upload.stdout.toString().trim();
  if (upload.code !== 0 || uploaded !== digest) {
    const detail = `helper 上传校验失败：期望 ${digest.slice(0, 12)}，远端 ${uploaded.slice(0, 12) || upload.stderr.trim()}`;
    onProgress?.({ step: 'verify', ok: false, detail });
    throw new Error(detail);
  }
  onProgress?.({ step: 'upload', ok: true, detail: `上传完成 ${body.length} 字节` });
  onProgress?.({ step: 'verify', ok: true, detail: 'sha256 校验通过' });
}

/** 一次启动：写 token、拉起 helper、把 run.json 里的端口读回来。 */
async function startHelper(target: RemoteTarget, dir: string, token: string): Promise<number> {
  const script = [
    'set -e',
    `dir=${dir}`,
    'umask 077',
    `printf '%s' ${shellQuote(token)} > "$dir/token"`,
    'rm -f "$dir/run.json"',
    `setsid nohup "$dir/dela-helper" --port 0 --token-file "$dir/token" --run-file "$dir/run.json" --idle-timeout ${IDLE_TIMEOUT} >> "$dir/helper.log" 2>&1 < /dev/null &`,
    'for i in $(seq 1 40); do [ -s "$dir/run.json" ] && break; sleep 0.25; done',
    'if [ -s "$dir/run.json" ]; then cat "$dir/run.json"; else printf START-FAILED; tail -n 3 "$dir/helper.log" 2>/dev/null; exit 4; fi',
  ].join('\n');
  const result = await exec(target, script, { timeoutMs: STARTUP_WAIT_MS });
  const text = result.stdout.toString().trim();
  if (result.code !== 0 || !text.startsWith('{'))
    throw new Error(`helper 启动失败：${text || result.stderr.trim()}`);
  const state = JSON.parse(text) as { port?: number };
  if (!state.port) throw new Error('helper 未报告端口');
  return state.port;
}

function createSession(target: RemoteTarget, port: number, token: string): HelperSession {
  return {
    target,
    port,
    async readFile(path, signal) {
      const response = await sendRequest(
        port,
        token,
        'GET',
        `/v1/fs/read?path=${encodeURIComponent(path)}`,
        { signal },
      );
      assertOk(response, `读取 ${path}`);
      return response.body;
    },
    async readFileRange(path, offset, length, signal) {
      const query = `path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`;
      const response = await sendRequest(port, token, 'GET', `/v1/fs/read?${query}`, { signal });
      assertOk(response, `读取 ${path}`);
      return response.body;
    },
    async writeFile(path, content) {
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      const response = await sendRequest(
        port,
        token,
        'PUT',
        `/v1/fs/write?path=${encodeURIComponent(path)}`,
        { body },
      );
      assertOk(response, `写入 ${path}`);
    },
    async list(path, signal) {
      // 目录清单一律是 POST + JSON：远端路径里可能有引号或中文，不进 query。
      const response = await sendRequest(port, token, 'POST', '/v1/fs/list', {
        body: Buffer.from(JSON.stringify({ path }), 'utf8'),
        signal,
      });
      assertOk(response, `列出 ${path}`);
      const body = JSON.parse(response.body.toString()) as { entries?: RemoteDirEntry[] };
      return body.entries ?? [];
    },
    async stat(paths, signal) {
      const response = await sendRequest(port, token, 'POST', '/v1/fs/stat', {
        body: Buffer.from(JSON.stringify({ paths }), 'utf8'),
        signal,
      });
      assertOk(response, `查询 ${paths.length} 个路径`);
      const body = JSON.parse(response.body.toString()) as { items?: HelperStat[] };
      return body.items ?? [];
    },
    async setWatch(id, paths) {
      const response = await sendRequest(port, token, 'POST', '/v1/watch', {
        body: Buffer.from(JSON.stringify({ id, paths }), 'utf8'),
      });
      assertOk(response, `监视 ${paths.length} 个目录`);
      const body = JSON.parse(response.body.toString()) as {
        watching?: number;
        skipped?: string[];
      };
      // skipped = 没挂上 watch 的目录（不存在、不是目录、inotify 额度满）：调用方要知道。
      return { watching: body.watching ?? 0, skipped: body.skipped ?? [] };
    },
    async clearWatch(id) {
      const response = await sendRequest(
        port,
        token,
        'DELETE',
        `/v1/watch?id=${encodeURIComponent(id)}`,
      );
      assertOk(response, `取消监视 ${id}`);
    },
    watchEvents: (onEvent, signal) => runWatch(port, token, onEvent, signal),
    exec: (command, options) => runExec(port, token, command, options),
  };
}

/** 一次读一行 SSE 的公共骨架：`data: <json>\n\n` 分帧，其它字段忽略。 */
function readSse(response: import('node:http').IncomingMessage, onJson: (value: unknown) => void) {
  let buffer = '';
  response.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      try {
        onJson(JSON.parse(line.slice(6)));
      } catch {
        /* 半截 JSON 只可能是分帧异常，丢掉这一帧不影响后续。 */
      }
    }
  });
}

/**
 * 目录事件流：一直挂着，直到通道断、helper 退出或被调用方取消。
 * 这里不设客户端超时（它本来就该长挂），但设一个静默看门狗：隧道半死时不会永远等下去。
 */
function runWatch(
  port: number,
  token: string,
  onEvent: (event: WatchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      if (error && !signal?.aborted) reject(error);
      else resolve();
    };
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: '/v1/watch',
        headers: { Authorization: `Bearer ${token}` },
      },
      (response) => {
        if ((response.statusCode ?? 0) !== 200) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            settle(new Error(`watch 失败：${chunks.join('').toString().trim().slice(0, 300)}`)),
          );
          return;
        }
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => request.destroy(new Error('watch 静默超时')), WATCH_IDLE_MS);
        };
        arm();
        response.on('data', () => arm());
        readSse(response, (value) => onEvent(value as WatchEvent));
        response.on('end', () => settle());
        response.on('error', (error) => settle(error));
        response.on('close', () => settle(new Error('watch 连接中断')));
      },
    );
    const onAbort = () => {
      request.destroy();
      settle();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error) => settle(error));
    request.end();
  });
}

/** 流式执行：SSE 四类事件，data 一律 base64；退出状态由 exit 事件给定。 */
function runExec(
  port: number,
  token: string,
  command: string,
  options: HelperExecOptions,
): Promise<HelperExecResult> {
  return new Promise((resolve, reject) => {
    let taskId = '';
    let finished = false;
    let buffer = '';
    let exit: { code: number; state: string; discarded: number } | null = null;
    let timer: NodeJS.Timeout | undefined;

    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/exec',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      (response) => {
        if ((response.statusCode ?? 0) !== 200) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            reject(new Error(`执行失败：${chunks.join('').toString().trim().slice(0, 300)}`)),
          );
          return;
        }
        response.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((item) => item.startsWith('data: '));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              taskId?: string;
              data?: string;
              code?: number;
              state?: string;
              discarded?: number;
            };
            if (event.type === 'start' && event.taskId) taskId = event.taskId;
            else if ((event.type === 'stdout' || event.type === 'stderr') && event.data)
              options.onData?.(Buffer.from(event.data, 'base64'));
            else if (event.type === 'exit')
              exit = {
                code: event.code ?? 0,
                state: event.state ?? 'exited',
                discarded: event.discarded ?? 0,
              };
          }
        });
        response.on('end', () => {
          finished = true;
          clearTimeout(timer);
          if (options.signal?.aborted) reject(new Error('aborted'));
          else if (!exit) reject(new Error('helper 未回传退出状态'));
          else
            resolve({
              code: exit.code,
              state: exit.state as HelperExecResult['state'],
              discarded: exit.discarded,
            });
        });
        // 响应开始之后错误只会落在 response 上：隧道半死时必须在这里落定，否则调用方永远等。
        response.on('error', (error) => settle(error));
        response.on('close', () => settle(new Error('helper 连接中断')));
      },
    );
    const settle = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(options.signal?.aborted ? new Error('aborted') : error);
    };
    const onAbort = () => {
      // 取消要显式告诉 helper：只断开本地连接会留下孤儿进程，构建工具的子孙会留在机器上。
      if (taskId) {
        void sendRequest(port, token, 'POST', `/v1/exec/${taskId}/cancel`).catch(() => {});
      }
      request.destroy();
      settle(new Error('aborted'));
    };
    // 兜底：helper 自己的超时先到；这条只在通道半死时救场。
    timer = setTimeout(
      () => request.destroy(new Error('请求超时')),
      (options.timeoutMs ?? REQUEST_TIMEOUT_MS) + EXEC_GRACE_MS,
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error) => {
      if (finished) return;
      settle(error);
    });
    request.end(
      JSON.stringify({
        command,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? 0,
        env: Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`),
      }),
    );
  });
}

interface ActiveChannel {
  session: HelperSession;
  timer: NodeJS.Timeout;
  tunnel: ReturnType<typeof spawn>;
}

async function ensure(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<ActiveChannel> {
  // 每一步失败都带着「是哪一步、为什么」报出去：向导的日志区就靠它说清楚停在哪里。
  const fail: (step: RemoteSetupProgress['step'], error: unknown) => never = (step, error) => {
    onProgress?.({
      step,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  };
  const probe = await exec(target, 'uname -s; uname -m', { timeoutMs: BOOTSTRAP_TIMEOUT_MS }).catch(
    (error: unknown) => fail('probe', error),
  );
  if (probe.code !== 0) fail('probe', new Error(probe.stderr.trim() || '无法探测远端系统'));
  const [system = '', machine = ''] = probe.stdout.toString().trim().split('\n');
  if (system.trim() !== 'Linux')
    fail('probe', new Error(`helper 只支持 Linux，远端是 ${system.trim()}`));
  const arch = helperArch(machine.trim());
  if (!arch) fail('probe', new Error(`helper 没有 ${machine.trim()} 的产物`));
  const artifact = helperArtifact(arch);
  if (!artifact) fail('probe', new Error(`缺少 helper 产物：linux/${arch}`));
  const digest = sha256Of(readFileSync(artifact));
  const dir = helperRemoteDir(digest);
  // 这里的探测不再单独报一行：向导的自检已经报过同一件事，重复两行只会让日志变吵。
  await ensureArtifact(target, dir, artifact, digest, onProgress);

  const token = randomBytes(24).toString('hex');
  const remotePort = await startHelper(target, dir, token).catch((error: unknown) =>
    fail('start', error),
  );
  onProgress?.({ step: 'start', ok: true, detail: `远端 127.0.0.1:${remotePort}` });
  const localPort = await freePort();
  const tunnel = spawn(locateSsh(), tunnelArguments(target, localPort, remotePort), {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let tunnelError = '';
  tunnel.stderr?.on('data', (chunk: Buffer) => {
    tunnelError += chunk.toString();
  });
  let tunnelReady = false;
  try {
    await waitForPort(localPort, TUNNEL_READY_MS);
    tunnelReady = true;
    onProgress?.({
      step: 'tunnel',
      ok: true,
      detail: `本地 127.0.0.1:${localPort} → 远端 127.0.0.1:${remotePort}`,
    });
    const hello = await jsonRequest<{ protocol: number; helperVersion: string }>(
      localPort,
      token,
      'GET',
      '/v1/hello',
    );
    if (hello.protocol !== PROTOCOL_VERSION || hello.helperVersion !== HELPER_VERSION)
      throw new Error(`helper 版本不匹配：协议 ${hello.protocol}、版本 ${hello.helperVersion}`);
    onProgress?.({
      step: 'handshake',
      ok: true,
      detail: `协议 ${hello.protocol} · helper ${hello.helperVersion}`,
    });
  } catch (error) {
    tunnel.kill();
    const detail = tunnelError.trim();
    // 端口没通算隧道失败，握手没过才算握手失败：两者给用户的排查方向不一样。
    fail(
      tunnelReady ? 'handshake' : 'tunnel',
      detail ? new Error(`${String(error)}｜${detail}`) : error,
    );
  }
  const session = createSession(target, localPort, token);
  const timer = setInterval(() => {
    void sendRequest(localPort, token, 'POST', '/v1/heartbeat', { timeoutMs: 10_000 }).catch(
      () => {},
    );
  }, HEARTBEAT_MS);
  return { session, timer, tunnel };
}

/** 同一时刻只保一条通道：切到别的连接就关掉旧的，避免 Dela 后面留一串 helper。 */
let current: { key: string; channel: Promise<ActiveChannel | null> } | null = null;

export async function helperSession(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<HelperSession | null> {
  const key = targetKey(target);
  if (current && current.key !== key) await closeHelper();
  if (!current) {
    const channel = ensure(target, onProgress).catch((error: unknown) => {
      console.warn('[remotes] helper 通道不可用，退回一次性 ssh', error);
      return null;
    });
    current = { key, channel };
    // 建立失败不留在 current 上：否则这一轮之后每次调用都立刻拿到 null，本进程再也不会重建通道。
    void channel.then((active) => {
      if (!active && current?.channel === channel) current = null;
    });
  }
  const active = await current.channel;
  return active?.session ?? null;
}

/**
 * 向导「连接」用：完整走一遍引导，并把每一步报出去。
 *
 * helperSession 把失败吞掉换成 null（那正是「降级到一次性 ssh」，调用方不需要知道细节），
 * 但向导要能说出「哪一步、为什么」，所以这里从进度流里把那条 ok:false 捞出来一并返回；
 * 上传与启动仍然只有 helperSession 这一条路，不为向导另开旁路缓存。
 */
export async function prepareHelper(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<{ session: HelperSession | null; failure: RemoteSetupProgress | null }> {
  let failure: RemoteSetupProgress | null = null;
  const session = await helperSession(target, (progress) => {
    if (progress.ok === false) failure = progress;
    onProgress?.(progress);
  });
  return { session, failure };
}

/**
 * 放掉当前通道：只做本地收尾（停心跳、关隧道），**不向远端发退出请求**。
 *
 * 远端的 helper 靠心跳判活：心跳一停，它最多再活 IDLE_TIMEOUT 就自己退出（顺带终止在跑的任务）。
 * 少一次远端往返就少一类失败——请求发不出去时远端本来就只能等空闲自退，本地再写一套兜底反而
 * 会在切换连接、通道出错时留下说不清的半开状态。
 */
export async function closeHelper(): Promise<void> {
  const active = current;
  current = null;
  if (!active) return;
  const channel = await active.channel;
  if (!channel) return;
  clearInterval(channel.timer);
  channel.tunnel.kill();
}
