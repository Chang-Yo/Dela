/**
 * 远端 runtime（dela-helper）通道：远程项目的全部工具调用都经这里，没有一次性 ssh 的退路。
 *
 * helper 在远端常驻（最后一个客户端断开后再活 1 小时），生命周期不随隧道：网络抖动只让本地进入
 * reconnecting，请求排队等通道回来，远端在跑的任务不受影响，重连后按偏移接回输出。
 * ssh 只承担引导（探测、上传、启动、诊断）、重连（读 run.json）与隧道本身。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { app } from 'electron';
import type { RemoteChannelState, RemoteSetupProgress, RemoteTask } from '../../shared/remotes';
import {
  exec,
  locateSsh,
  shellQuote,
  sshBaseArguments,
  sshErrorMessage,
  targetKey,
  type RemoteDirEntry,
  type RemoteTarget,
} from './transport';

/** 必须与 helper/main.go 的 helperVersion 一致：不匹配说明远端跑的不是这一版产物。 */
export const HELPER_VERSION = '0.3.1';
const PROTOCOL_VERSION = 2;
/** 客户端每 30 秒发一次心跳；helper 连续 1 小时收不到任何请求才退出。 */
const HEARTBEAT_MS = 30_000;
const IDLE_TIMEOUT = '1h';
const BOOTSTRAP_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 120_000;
const TUNNEL_READY_MS = 5_000;
const STARTUP_WAIT_MS = 20_000;
const PROBE_TIMEOUT_MS = 3_000;
/** 心跳连续失败几次算隧道断了：一次失败可能只是隧道被大响应占着。 */
const HEARTBEAT_FAILURES_BEFORE_LOST = 3;
/** 重连退避：1、2、4…秒，封顶 8 秒；整个重连窗口 60 秒，过了就判为不可用。 */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 8_000;
const RECONNECT_WINDOW_MS = 60_000;
/** 不可用之后，下一次调用距上次尝试超过这么久就自动再试一次（不定时轮询远端）。 */
const RETRY_AFTER_MS = 30_000;
/** 任务输出流多久没有字节算隧道半死：helper 在安静的流上每 30 秒发一条保活注释。 */
const STREAM_IDLE_MS = 90_000;

/** helper 推回来的目录事件：change 是「这几层要重读」，reset 是「丢过事件，整片重读」。 */
export type WatchEvent =
  { type: 'change'; id: string; paths: string[] } | { type: 'reset'; id: string; reason: string };

/** 远端架构 → 产物名里的 GOARCH。 */
function helperArch(machine: string): 'amd64' | 'arm64' | null {
  if (machine === 'x86_64' || machine === 'amd64') return 'amd64';
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64';
  return null;
}

/** 本地产物路径：开发时在 vendor/，打包后在 resources/。 */
export function helperArtifact(arch: string): string | null {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'dela-helper')
    : join(app.getAppPath(), 'vendor', 'dela-helper');
  const path = join(root, `dela-helper-linux-${arch}`);
  return existsSync(path) ? path : null;
}

/** 远端目录按「版本-sha8」分家：换版本换目录，旧目录留着（每版一个，便于回退，不自动清理）。 */
function helperRemoteDir(digest: string): string {
  return `$HOME/.dela/helper/${HELPER_VERSION}-${digest.slice(0, 8)}`;
}

/**
 * 分类受限环境的诊断输出（一行 key=value，竖线分隔）。
 * noexec／只读挂载／SELinux 的表象都一样——helper 起不来，原因必须单独问一次才说得清。
 * 这些环境不在支持范围内，分类只为让用户知道为什么用不了。
 */
export function classifyEnvironment(output: string): string | null {
  const values = new Map<string, string>();
  for (const pair of output.split('|')) {
    const cut = pair.indexOf('=');
    if (cut > 0) values.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
  }
  const options = (values.get('mount') ?? '').split(',').map((option) => option.trim());
  const execDenied = (values.get('direct') ?? '').startsWith('exit-');
  if (options.includes('noexec'))
    return 'helper 目录所在挂载点启用了 noexec，服务器不允许执行这里的文件';
  if (options.includes('ro')) return 'helper 目录所在挂载点是只读的（$HOME 可能被设为只读）';
  if (values.get('writable') === 'no') return 'helper 目录不可写（权限不足或只读 $HOME）';
  if (execDenied && values.get('selinux') === 'Enforcing')
    return 'SELinux 处于 Enforcing，拦截了 helper 的执行';
  if (execDenied) return '直接执行 helper 被拒绝（通常是 noexec 或安全模块拦截）';
  return null;
}

/** 启动失败后的诊断：只读探查，不改动远端任何东西；诊断本身失败不影响原有错误信息。 */
async function diagnoseEnvironment(target: RemoteTarget, dir: string): Promise<string | null> {
  try {
    const script = [
      `dir=${dir}`,
      `printf 'mount='; findmnt -no OPTIONS -T "$dir" 2>/dev/null || true`,
      `printf '|writable='; [ -w "$dir" ] && echo yes || echo no`,
      `printf '|selinux='; getenforce 2>/dev/null || echo absent`,
      `printf '|direct='; "$dir/dela-helper" --version >/dev/null 2>&1 && echo ok || echo "exit-$?"`,
    ].join('\n');
    const result = await exec(target, script, { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    if (result.code !== 0) return null;
    return classifyEnvironment(result.stdout.toString());
  } catch {
    return null;
  }
}

/** 隧道参数：与一次性调用的连接参数同源，只多一个 -L 与 -N。 */
function tunnelArguments(target: RemoteTarget, localPort: number, remotePort: number): string[] {
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

interface Tunnel {
  localPort: number;
  process: ChildProcess;
}

/** 起一条 `ssh -L` 并等本地端口可连；失败时把 ssh 的 stderr 一并带上。 */
async function openTunnel(target: RemoteTarget, remotePort: number): Promise<Tunnel> {
  const localPort = await freePort();
  const tunnel = spawn(locateSsh(), tunnelArguments(target, localPort, remotePort), {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  tunnel.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await waitForPort(localPort, TUNNEL_READY_MS, tunnel);
    return { localPort, process: tunnel };
  } catch (error) {
    tunnel.kill();
    const detail = stderr.trim();
    throw detail ? new Error(`${String(error)}｜${detail}`) : error;
  }
}

/**
 * 端口预览用的独立隧道：与 helper 通道无关——通道重连、不可用都不影响它，生命周期归调用方。
 * 远端服务死了隧道还在：浏览器报连接拒绝就是准确的反馈。
 */
export async function openPortTunnel(
  target: RemoteTarget,
  remotePort: number,
): Promise<PortTunnel> {
  const tunnel = await openTunnel(target, remotePort);
  let closed = false;
  return {
    localPort: tunnel.localPort,
    close() {
      if (closed) return;
      closed = true;
      tunnel.process.kill();
    },
  };
}

export interface HelperExecOptions {
  cwd: string;
  signal?: AbortSignal;
  /** 毫秒；由调用方换算。 */
  timeoutMs?: number;
  env?: Record<string, string>;
  onData?: (chunk: Buffer) => void;
}

export interface HelperExecResult {
  code: number;
  state: 'exited' | 'cancelled' | 'timeout';
  /** 断线期间被缓冲挤掉、没能接回的字节数。 */
  lost: number;
}

/** helper 的 stat 结果；路径不存在时 exists 为 false，其余字段为零值。 */
export interface HelperStat {
  path: string;
  exists: boolean;
  directory: boolean;
  readable: boolean;
  size: number;
  modifiedAt: number;
}

/** list 带 locate 时的回答：路径不是目录也不报错。 */
export interface HelperLocation {
  path: string;
  kind: 'directory' | 'file' | 'missing';
  entries: RemoteDirEntry[];
}

export interface HelperGlobResult {
  files: string[];
  truncated: boolean;
}

export interface HelperSearchRequest {
  path: string;
  pattern: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface HelperSearchMatch {
  path: string;
  line: number;
  text: string;
  context?: { line: number; text: string }[];
}

export interface HelperSearchResult {
  matches: HelperSearchMatch[];
  truncated: boolean;
}

/** 远端监听端口（/v1/ports）：pid 与进程名拿不到（别的用户）时缺省。 */
export interface HelperPort {
  port: number;
  pid?: number;
  process?: string;
}

export interface PortTunnel {
  localPort: number;
  close(): void;
}

export interface HelperSession {
  target: RemoteTarget;
  readFile(path: string, signal?: AbortSignal): Promise<Buffer>;
  /** 片段读取（预览大文件用）：只把请求的那一段拉回本地，不整篇进内存。 */
  readFileRange(
    path: string,
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  /** 原子写；缺失的父目录由 helper 建好。 */
  writeFile(path: string, content: Buffer | string): Promise<void>;
  list(path: string, signal?: AbortSignal): Promise<RemoteDirEntry[]>;
  /** 一次请求回答「存在吗、是目录吗、里面有什么」：目录选择器用。 */
  locate(path: string, signal?: AbortSignal): Promise<HelperLocation>;
  stat(paths: string[], signal?: AbortSignal): Promise<HelperStat[]>;
  glob(
    path: string,
    pattern: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<HelperGlobResult>;
  search(request: HelperSearchRequest, signal?: AbortSignal): Promise<HelperSearchResult>;
  /** 替换某个 id 的目录监视集合（只监视这些目录本身，不递归）。 */
  setWatch(id: string, paths: string[]): Promise<{ watching: number; skipped: string[] }>;
  clearWatch(id: string): Promise<void>;
  listPorts(): Promise<HelperPort[]>;
  listTasks(): Promise<RemoteTask[]>;
  cancelTask(id: string): Promise<void>;
  /** 目录事件流：resolve 表示流结束（隧道断/helper 退出），由调用方决定是否重连。 */
  watchEvents(onEvent: (event: WatchEvent) => void, signal?: AbortSignal): Promise<void>;
  /** 执行命令：断线时等通道回来、按偏移接回，命令本身只执行一次。 */
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

/** 隧道端口由 ssh 绑定，连得上不代表远端已在听；真正的就绪判断是随后的握手。
 *  ssh 提前退出（认证失败、远端端口不通）时立刻失败，不等满超时。 */
function waitForPort(port: number, timeoutMs: number, owner?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    owner?.once('exit', () => {
      exited = true;
    });
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (exited) reject(new Error('隧道进程已退出'));
        else if (Date.now() > deadline) reject(new Error('隧道未就绪'));
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

/** 隧道层面的失败（连不上、断在半路、超时）：重连能救。HTTP 非 2xx 不是这一类。 */
export class HelperTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelperTransportError';
  }
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

/** 远端当前不可用（引导失败、重连超时）：带着分类过的原因，不再重试。 */
export class HelperUnavailableError extends Error {
  constructor(
    readonly destination: string,
    readonly reason: string,
  ) {
    super(`远端 ${destination} 不可用：${reason}`);
    this.name = 'HelperUnavailableError';
  }
}

const aborted = () => new Error('aborted');

interface Endpoint {
  port: number;
  token: string;
}

function sendRequest(
  endpoint: Endpoint,
  method: string,
  path: string,
  options: { body?: Buffer | string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    // 一次请求有三个可能落定的地方（request 出错、响应读完、响应中途断掉）。
    // 响应开始之后必须由 response 侧落定：否则隧道半死（响应头到了、正文没读完）时这个 Promise 永远不落定。
    let settled = false;
    let responded = false;
    const settle = (error?: Error, value?: HttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) reject(aborted());
      else if (error) reject(error);
      else resolve(value!);
    };
    if (options.signal?.aborted) {
      reject(aborted());
      return;
    }
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method,
        path,
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
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
        response.on('error', () => settle(new HelperTransportError('helper 连接中断')));
        response.on('close', () => settle(new HelperTransportError('helper 连接中断')));
      },
    );
    const timer = setTimeout(
      () => request.destroy(new HelperTransportError('请求超时')),
      options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const onAbort = () => request.destroy(aborted());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error: Error) =>
      settle(
        error instanceof HelperTransportError ? error : new HelperTransportError(error.message),
      ),
    );
    request.on('close', () => {
      if (!responded) settle(new HelperTransportError('helper 连接中断'));
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
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
  throw new HelperHttpError(`${what}失败：${detail.slice(0, 300)}`, response.status);
}

/** 打开一条 SSE 流；非 200 读完正文按业务错误抛，200 交给 onFrame 逐帧处理直到流结束。
 *  安静超过 idleMs（helper 会定期发保活注释）就判为隧道半死。 */
function openSse(
  endpoint: Endpoint,
  path: string,
  onFrame: (value: unknown) => void,
  options: { signal?: AbortSignal; idleMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) reject(aborted());
      else if (error) reject(error);
      else resolve();
    };
    if (options.signal?.aborted) {
      reject(aborted());
      return;
    }
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method: 'GET',
        path,
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
      (response: IncomingMessage) => {
        if ((response.statusCode ?? 0) !== 200) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            try {
              assertOk({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }, path);
            } catch (error) {
              settle(error as Error);
            }
          });
          return;
        }
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () => request.destroy(new HelperTransportError('流静默超时')),
            options.idleMs,
          );
        };
        arm();
        let buffer = '';
        response.on('data', (chunk: Buffer) => {
          arm();
          buffer += chunk.toString('utf8');
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((item) => item.startsWith('data: '));
            if (!line) continue;
            let value: unknown;
            try {
              value = JSON.parse(line.slice(6));
            } catch {
              continue; // 半截 JSON 只可能是分帧异常，丢掉这一帧不影响后续
            }
            onFrame(value);
          }
        });
        response.on('end', () => settle());
        response.on('error', () => settle(new HelperTransportError('流中断')));
        response.on('close', () => settle(new HelperTransportError('流中断')));
      },
    );
    const onAbort = () => request.destroy(aborted());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error: Error) =>
      settle(
        error instanceof HelperTransportError ? error : new HelperTransportError(error.message),
      ),
    );
    request.end();
  });
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
  if (probe.code !== 0) throw new Error(sshErrorMessage(probe));
  if (probe.stdout.toString().trim() === 'READY') {
    onProgress?.({ step: 'verify', ok: true, detail: '远端已有这一版产物，跳过上传' });
    return;
  }

  // base64 走 ssh 的 stdin：二进制内容不经过 shell 解析，落盘后再核一次 sha256。
  // 进度按 base64 字节折回原始字节报：界面显示的是产物大小，不是编码后的大小。
  const body = readFileSync(artifact);
  onProgress?.({ step: 'upload', detail: '开始上传', bytes: { sent: 0, total: body.length } });
  let reported = 0;
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
    {
      stdin: `${body.toString('base64')}\n`,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      onStdinProgress: (sent, total) => {
        const bytes = Math.round((sent / total) * body.length);
        // 至少隔 2% 报一次：64 KB 一块会有上百次回调，界面不需要那么密。
        if (bytes - reported < body.length / 50 && sent < total) return;
        reported = bytes;
        onProgress?.({ step: 'upload', bytes: { sent: bytes, total: body.length } });
      },
    },
  );
  const uploaded = upload.stdout.toString().trim();
  if (upload.code !== 0 || uploaded !== digest) {
    onProgress?.({ step: 'upload', ok: false });
    throw new Error(
      `helper 上传校验失败：期望 ${digest.slice(0, 12)}，远端 ${uploaded.slice(0, 12) || upload.stderr.trim()}`,
    );
  }
  onProgress?.({
    step: 'upload',
    ok: true,
    detail: '上传完成',
    bytes: { sent: body.length, total: body.length },
  });
  onProgress?.({ step: 'verify', ok: true, detail: 'sha256 校验通过' });
}

/**
 * 找到或起一个 helper，返回它的端口与 token。一次 ssh 完成：
 * run.json 在、pid 活着、版本对得上就复用（token 留在 0600 文件里）；否则写新 token 起新实例。
 * 两个 Dela 同时起时 helper 自己用 flock 只放一个进来，抢输的那个退出码 3，脚本改为等对方的 run.json。
 */
async function findOrStart(
  target: RemoteTarget,
  dir: string,
): Promise<Endpoint & { reused: boolean }> {
  const token = randomBytes(24).toString('hex');
  const script = [
    'set -e',
    `dir=${dir}`,
    'umask 077',
    // 复用判定：pid 活着且 /proc 里的可执行文件就是这个目录下的那份。
    'alive() { [ -s "$dir/run.json" ] && pid=$(sed -n \'s/.*"pid":\\([0-9]*\\).*/\\1/p\' "$dir/run.json") && [ -n "$pid" ] && [ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$dir/dela-helper" ]; }',
    'if alive; then printf REUSE; cat "$dir/run.json"; printf "\\n"; cat "$dir/token"; exit 0; fi',
    `printf '%s' ${shellQuote(token)} > "$dir/token.new"`,
    'mv -f "$dir/token.new" "$dir/token"',
    'rm -f "$dir/run.json"',
    `setsid nohup "$dir/dela-helper" --port 0 --token-file "$dir/token" --run-file "$dir/run.json" --lock-file "$dir/lock" --idle-timeout ${IDLE_TIMEOUT} >> "$dir/helper.log" 2>&1 < /dev/null &`,
    'for i in $(seq 1 40); do alive && break; sleep 0.25; done',
    'if alive; then printf START; cat "$dir/run.json"; printf "\\n"; cat "$dir/token"; else printf START-FAILED; tail -n 3 "$dir/helper.log" 2>/dev/null; exit 4; fi',
  ].join('\n');
  const result = await exec(target, script, { timeoutMs: STARTUP_WAIT_MS });
  const text = result.stdout.toString();
  // REUSE 与 START 等长：去掉标记后是「run.json 一行 + token 一行」。
  const reused = text.startsWith('REUSE');
  if (result.code !== 0 || !(reused || text.startsWith('START{')))
    throw new Error(`helper 启动失败：${text.trim() || sshErrorMessage(result)}`);
  const [state = '', remoteToken = ''] = text.slice('START'.length).split('\n');
  const port = (JSON.parse(state) as { port?: number }).port;
  if (!port || remoteToken.trim().length < 16) throw new Error('helper 未报告端口或 token');
  return { port, token: remoteToken.trim(), reused };
}

/** 引导：探测系统 → 确保产物 → 找到或起实例。只用 ssh；重连也走这里（产物在时只多一次 sha 比对）。 */
async function bootstrap(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<{ remote: Endpoint; dir: string }> {
  const step = async <T>(name: RemoteSetupProgress['step'], work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      onProgress?.({
        step: name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  const artifact = await step('probe', async () => {
    const probe = await exec(target, 'uname -s; uname -m', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    if (probe.code !== 0) throw new Error(sshErrorMessage(probe));
    const [system = '', machine = ''] = probe.stdout.toString().trim().split('\n');
    if (system.trim() !== 'Linux') throw new Error(`远程项目只支持 Linux，远端是 ${system.trim()}`);
    const arch = helperArch(machine.trim());
    if (!arch) throw new Error(`没有 ${machine.trim()} 架构的 helper`);
    const artifact = helperArtifact(arch);
    if (!artifact) throw new Error(`缺少 helper 产物：linux/${arch}`);
    return artifact;
  });
  const digest = sha256Of(readFileSync(artifact));
  const dir = helperRemoteDir(digest);
  await step('verify', () => ensureArtifact(target, dir, artifact, digest, onProgress));
  const remote = await step('start', async () => {
    try {
      return await findOrStart(target, dir);
    } catch (error) {
      // 起不来的最常见原因是受限环境：先问一次远端把原因分类出来。
      const message = error instanceof Error ? error.message : String(error);
      const diagnosis = await diagnoseEnvironment(target, dir);
      throw new Error(diagnosis ? `${message}（诊断：${diagnosis}）` : message);
    }
  });
  onProgress?.({
    step: 'start',
    ok: true,
    detail: `${remote.reused ? '复用已在运行的实例' : '已启动新实例'}，远端 127.0.0.1:${remote.port}`,
  });
  return { remote, dir };
}
/** 一条可用的连接：隧道进程退出即视为断开。 */
interface Link {
  endpoint: Endpoint;
  process: ChildProcess;
  /** 远端主目录（hello 里带回来）。 */
  home: string;
}

/** 建立连接的一整步（引导 + 隧道 + 握手）：通道的状态机只依赖它，测试可以换成本地假实现。 */
export type Connector = (
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
) => Promise<Link>;

const connectRemote: Connector = async (target, onProgress) => {
  const { remote } = await bootstrap(target, onProgress);
  let tunnel: Tunnel;
  try {
    tunnel = await openTunnel(target, remote.port);
  } catch (error) {
    onProgress?.({ step: 'tunnel', ok: false, detail: String(error) });
    throw error;
  }
  onProgress?.({
    step: 'tunnel',
    ok: true,
    detail: `本地 127.0.0.1:${tunnel.localPort} → 远端 127.0.0.1:${remote.port}`,
  });
  const endpoint = { port: tunnel.localPort, token: remote.token };
  let home = '';
  try {
    const response = await sendRequest(endpoint, 'GET', '/v1/hello', { timeoutMs: 10_000 });
    assertOk(response, '握手');
    const hello = JSON.parse(response.body.toString()) as {
      protocol: number;
      helperVersion: string;
      home?: string;
    };
    home = hello.home ?? '';
    if (hello.protocol !== PROTOCOL_VERSION || hello.helperVersion !== HELPER_VERSION)
      throw new Error(`helper 版本不匹配：协议 ${hello.protocol}、版本 ${hello.helperVersion}`);
    onProgress?.({
      step: 'handshake',
      ok: true,
      detail: `协议 ${hello.protocol} · helper ${hello.helperVersion}`,
    });
  } catch (error) {
    tunnel.process.kill();
    onProgress?.({ step: 'handshake', ok: false, detail: String(error) });
    throw error;
  }
  return { endpoint, process: tunnel.process, home };
};

/** 通道状态：每台服务器一条通道，状态整份快照推给渲染端。 */
export type ChannelState = 'connecting' | 'ready' | 'reconnecting' | 'unavailable';

/**
 * 一台服务器一条通道。会话对象在通道一生中不变：重连只换隧道与本地端口，调用方拿着的 session
 * 继续可用，请求在 reconnecting 期间排队，回来后照常发出。
 */
class Channel {
  state: ChannelState = 'connecting';
  reason = '';
  since = Date.now();
  /** 远端主目录：每次连上时由 hello 带回。 */
  home = '';
  private endpoint: Endpoint | null = null;
  private tunnel: ChildProcess | null = null;
  private heartbeat: NodeJS.Timeout | undefined;
  /** 等通道可用的请求：ready 时 resolve，unavailable 时 reject。 */
  private waiters: { resolve: (endpoint: Endpoint) => void; reject: (error: Error) => void }[] = [];
  private connecting: Promise<void> | null = null;
  private lastAttempt = 0;
  private closed = false;
  readonly session: HelperSession;

  constructor(
    readonly target: RemoteTarget,
    private readonly onState: () => void,
    private readonly connector: Connector = connectRemote,
  ) {
    this.session = createSession(this);
  }

  /** 拿一个可用端点：ready 立刻给；连接中排队；不可用时距上次尝试够久就再试一次，否则直接报错。 */
  endpointFor(signal?: AbortSignal): Promise<Endpoint> {
    if (this.closed)
      return Promise.reject(new HelperUnavailableError(this.target.host, '通道已关闭'));
    if (this.state === 'ready' && this.endpoint) return Promise.resolve(this.endpoint);
    if (this.state === 'unavailable') {
      if (Date.now() - this.lastAttempt < RETRY_AFTER_MS)
        return Promise.reject(new HelperUnavailableError(this.target.host, this.reason));
      this.connect('connecting');
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (endpoint: Endpoint) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(endpoint);
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      const onAbort = () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(aborted());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** 手动重试：不可用时立刻重新引导，不等自动重试的间隔；其余状态什么都不做。 */
  async retry(): Promise<void> {
    if (this.state === 'unavailable') await this.connect('connecting');
  }

  snapshotWithHome() {
    return { ...this.snapshot(), home: this.home };
  }

  snapshot(): RemoteChannelState {
    return {
      destination: this.target.host,
      state: this.state,
      reason: this.reason,
      since: this.since,
    };
  }

  /** 引导或重连：同一时刻只跑一轮。progress 只在首次引导时有人听（向导的日志区）。 */
  connect(state: 'connecting' | 'reconnecting', onProgress?: (p: RemoteSetupProgress) => void) {
    if (this.connecting) return this.connecting;
    this.setState(state);
    this.connecting = this.run(state, onProgress).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async run(
    state: 'connecting' | 'reconnecting',
    onProgress?: (p: RemoteSetupProgress) => void,
  ): Promise<void> {
    const deadline = Date.now() + RECONNECT_WINDOW_MS;
    let backoff = RECONNECT_MIN_MS;
    for (;;) {
      this.lastAttempt = Date.now();
      try {
        await this.establish(onProgress);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // 首次引导失败多半是确定性的（不支持的系统、noexec、认证失败），不必退避重试；
        // 重连失败多半是网络还没恢复，在窗口内退避重试。
        if (this.closed || state === 'connecting' || Date.now() + backoff > deadline) {
          if (!this.closed) this.fail(reason.slice(0, 300));
          return;
        }
        console.warn(`[remotes] ${this.target.host} 重连失败，${backoff}ms 后重试`, reason);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      }
    }
  }

  private async establish(onProgress?: (p: RemoteSetupProgress) => void): Promise<void> {
    const link = await this.connector(this.target, onProgress);
    if (this.closed) {
      link.process.kill();
      return;
    }
    this.tunnel = link.process;
    this.endpoint = link.endpoint;
    this.home = link.home;
    link.process.once('exit', () => {
      if (this.tunnel === link.process) this.lost('隧道进程退出');
    });
    this.startHeartbeat(link.endpoint);
    this.setState('ready');
    for (const waiter of this.waiters.splice(0)) waiter.resolve(link.endpoint);
  }

  private startHeartbeat(endpoint: Endpoint) {
    clearInterval(this.heartbeat);
    let failures = 0;
    this.heartbeat = setInterval(() => {
      void sendRequest(endpoint, 'POST', '/v1/heartbeat', { timeoutMs: 10_000 })
        .then(() => {
          failures = 0;
        })
        .catch(() => {
          if (++failures >= HEARTBEAT_FAILURES_BEFORE_LOST && this.endpoint === endpoint)
            this.lost('心跳连续失败');
        });
    }, HEARTBEAT_MS);
  }

  /** 隧道断了（或半死）：拆掉本地这一侧，进 reconnecting。远端实例与任务不受影响。 */
  lost(why: string) {
    if (this.closed || this.state !== 'ready') return;
    console.warn(`[remotes] ${this.target.host} 通道中断（${why}），开始重连`);
    this.teardown();
    void this.connect('reconnecting');
  }

  /** 一次请求以隧道错误失败时调用：探一次活，确实不通才进重连（别让一次超时拆掉好通道）。 */
  async suspect(endpoint: Endpoint) {
    if (this.endpoint !== endpoint) return;
    try {
      const response = await sendRequest(endpoint, 'GET', '/v1/hello', {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (response.status >= 200 && response.status < 300) return;
    } catch {
      // 落到下面
    }
    if (this.endpoint === endpoint) this.lost('探活失败');
  }

  private fail(reason: string) {
    this.reason = reason;
    this.setState('unavailable');
    const error = new HelperUnavailableError(this.target.host, reason);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private teardown() {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.endpoint = null;
    tunnel?.kill();
  }

  /** 只做本地收尾，不向远端发退出请求：远端靠空闲超时自己退出。 */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.teardown();
    for (const waiter of this.waiters.splice(0))
      waiter.reject(new HelperUnavailableError(this.target.host, '通道已关闭'));
  }

  private setState(state: ChannelState) {
    if (this.state !== state) {
      this.state = state;
      this.since = Date.now();
    }
    if (state !== 'unavailable') this.reason = '';
    this.onState();
  }
}

/**
 * 发一个可以安全重发的请求：隧道错误时等通道回来再发一次。只读请求、整文件写入（内容相同，
 * 重发结果一样）、监视集合替换都属于这一类；任务创建靠 id 去重，也可以。
 */
async function retrying<T>(
  channel: Channel,
  signal: AbortSignal | undefined,
  work: (endpoint: Endpoint) => Promise<T>,
): Promise<T> {
  for (;;) {
    const endpoint = await channel.endpointFor(signal);
    try {
      return await work(endpoint);
    } catch (error) {
      if (!(error instanceof HelperTransportError) || signal?.aborted) throw error;
      await channel.suspect(endpoint);
    }
  }
}

function createSession(channel: Channel): HelperSession {
  const request = (
    method: string,
    path: string,
    what: string,
    options: { body?: Buffer | string; signal?: AbortSignal } = {},
  ) =>
    retrying(channel, options.signal, async (endpoint) => {
      const response = await sendRequest(endpoint, method, path, options);
      assertOk(response, what);
      return response.body;
    });
  const json = async <T>(
    method: string,
    path: string,
    what: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> =>
    JSON.parse(
      (
        await request(method, path, what, {
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        })
      ).toString(),
    ) as T;

  return {
    target: channel.target,
    readFile: (path, signal) =>
      request('GET', `/v1/fs/read?path=${encodeURIComponent(path)}`, `读取 ${path} `, { signal }),
    readFileRange: (path, offset, length, signal) =>
      request(
        'GET',
        `/v1/fs/read?path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`,
        `读取 ${path} `,
        { signal },
      ),
    async writeFile(path, content) {
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      await request(
        'PUT',
        `/v1/fs/write?parents=1&path=${encodeURIComponent(path)}`,
        `写入 ${path} `,
        {
          body,
        },
      );
    },
    // 目录与搜索一律 POST + JSON：远端路径里可能有引号或中文，不进 query。
    list: async (path, signal) =>
      (
        await json<{ entries?: RemoteDirEntry[] }>(
          'POST',
          '/v1/fs/list',
          `列出 ${path} `,
          { path },
          signal,
        )
      ).entries ?? [],
    locate: async (path, signal) => {
      const body = await json<{ kind: HelperLocation['kind']; entries?: RemoteDirEntry[] }>(
        'POST',
        '/v1/fs/list',
        `列出 ${path} `,
        { path, locate: true },
        signal,
      );
      return { path, kind: body.kind, entries: body.entries ?? [] };
    },
    stat: async (paths, signal) =>
      (await json<{ items?: HelperStat[] }>('POST', '/v1/fs/stat', '查询路径', { paths }, signal))
        .items ?? [],
    glob: (path, pattern, limit, signal) =>
      json<HelperGlobResult>('POST', '/v1/fs/glob', '查找文件', { path, pattern, limit }, signal),
    search: (body, signal) =>
      json<HelperSearchResult>('POST', '/v1/fs/search', '搜索', body, signal),
    async setWatch(id, paths) {
      const body = await json<{ watching?: number; skipped?: string[] }>(
        'POST',
        '/v1/watch',
        `监视 ${paths.length} 个目录`,
        { id, paths },
      );
      // skipped = 没挂上 watch 的目录（不存在、不是目录、inotify 额度满）：调用方要知道。
      return { watching: body.watching ?? 0, skipped: body.skipped ?? [] };
    },
    async clearWatch(id) {
      await request('DELETE', `/v1/watch?id=${encodeURIComponent(id)}`, `取消监视 ${id} `);
    },
    listPorts: async () =>
      (await json<{ ports?: HelperPort[] }>('GET', '/v1/ports', '列出远端端口')).ports ?? [],
    listTasks: async () =>
      (await json<{ tasks?: RemoteTask[] }>('GET', '/v1/tasks', '列出远端任务')).tasks ?? [],
    async cancelTask(id) {
      await request('POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`, `取消任务 ${id} `);
    },
    // watch 流不重试：它本来就该长挂，断了由 watch.ts 自己的循环决定何时重连。
    async watchEvents(onEvent, signal) {
      const endpoint = await channel.endpointFor(signal);
      try {
        await openSse(endpoint, '/v1/watch', (value) => onEvent(value as WatchEvent), {
          signal,
          idleMs: STREAM_IDLE_MS,
        });
      } catch (error) {
        if (error instanceof HelperTransportError) void channel.suspect(endpoint);
        throw error;
      }
    },
    exec: (command, options) => runTask(channel, command, options),
  };
}

interface TaskFrame {
  type: 'output' | 'gap' | 'exit';
  offset?: number;
  data?: string;
  bytes?: number;
  state?: HelperExecResult['state'];
  code?: number;
}

/**
 * 跑一条命令并把输出接回来。
 *
 * 任务 id 在本地生成：创建请求可能已经落地、响应却丢在半路，重连后用同一个 id 再提交，
 * helper 只返回已有任务，不会再执行一遍。输出按绝对偏移续读，断线期间被缓冲挤掉的部分记进 lost。
 */
async function runTask(
  channel: Channel,
  command: string,
  options: HelperExecOptions,
): Promise<HelperExecResult> {
  const id = randomBytes(12).toString('hex');
  const body = JSON.stringify({
    id,
    command,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 0,
    env: Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`),
  });
  const signal = options.signal;
  // 取消要显式告诉 helper：断开本地连接已经不会终止任务了。
  const cancel = () => {
    void channel
      .endpointFor()
      .then((endpoint) =>
        sendRequest(endpoint, 'POST', `/v1/tasks/${id}/cancel`, { timeoutMs: 10_000 }),
      )
      .catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await retrying(channel, signal, async (endpoint) => {
      const response = await sendRequest(endpoint, 'POST', '/v1/tasks', { body, signal });
      assertOk(response, '执行命令');
    });
    let offset = 0;
    let lost = 0;
    let exit: TaskFrame | null = null;
    while (!exit) {
      const endpoint = await channel.endpointFor(signal);
      try {
        await openSse(
          endpoint,
          `/v1/tasks/${id}/stream?offset=${offset}`,
          (value) => {
            const frame = value as TaskFrame;
            if (frame.type === 'gap') {
              lost += frame.bytes ?? 0;
              offset += frame.bytes ?? 0;
            } else if (frame.type === 'output' && frame.data) {
              const chunk = Buffer.from(frame.data, 'base64');
              offset = (frame.offset ?? offset) + chunk.length;
              options.onData?.(chunk);
            } else if (frame.type === 'exit') exit = frame;
          },
          { signal, idleMs: STREAM_IDLE_MS },
        );
        if (!exit) throw new HelperTransportError('任务流提前结束');
      } catch (error) {
        if (!(error instanceof HelperTransportError) || signal?.aborted) throw error;
        await channel.suspect(endpoint);
      }
    }
    const final = exit as TaskFrame;
    return { code: final.code ?? 0, state: final.state ?? 'exited', lost };
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * 一个连接一条通道，可同时存在多条：一台服务器重连、不可用都不影响另一台。
 * 通道在本进程内常驻（直到应用退出或显式 closeHelper），上界是用到过的连接数。
 */
const channels = new Map<string, Channel>();

let connector: Connector = connectRemote;

/** 仅测试用：换掉建立连接的那一步（引导 + 隧道 + 握手），状态机与会话照常运行。 */
export function setConnectorForTesting(next: Connector | null): void {
  connector = next ?? connectRemote;
}

const stateListeners = new Set<(states: RemoteChannelState[]) => void>();

/** 全部通道的状态快照。 */
export function helperStates(): RemoteChannelState[] {
  return [...channels.values()].map((channel) => channel.snapshot());
}

/** 订阅通道状态：每次任何一条通道变化都推整份快照。 */
export function onHelperState(listener: (states: RemoteChannelState[]) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function broadcast(): void {
  const snapshot = helperStates();
  for (const listener of stateListeners) listener(snapshot);
}

function channelFor(target: RemoteTarget): Channel {
  const key = targetKey(target);
  let channel = channels.get(key);
  if (!channel) {
    channel = new Channel(target, broadcast, connector);
    channels.set(key, channel);
    void channel.connect('connecting');
  }
  return channel;
}

/** 拿到某个连接的会话。会话对象在通道一生中不变；通道不可用时它的每个调用都会以
 *  HelperUnavailableError 失败（带分类过的原因），没有别的退路。 */
export function helperSession(target: RemoteTarget): HelperSession {
  return channelFor(target).session;
}

/** 手动重试一条通道，返回重试之后的状态。 */
export async function retryHelper(target: RemoteTarget): Promise<RemoteChannelState> {
  const channel = channelFor(target);
  await channel.retry();
  return channel.snapshot();
}

/** 等这条通道第一次就绪或判为不可用：向导与需要「先连上再说」的入口用。 */
export async function readyHelper(target: RemoteTarget): Promise<HelperSession> {
  const channel = channelFor(target);
  await channel.endpointFor();
  return channel.session;
}

/**
 * 向导「连接」用：已经连上就直接返回；否则完整走一遍引导，把每一步报出去。
 * 不可用的通道丢掉重来，这样「重试」总能看到一份完整的日志。
 */
export async function prepareHelper(
  target: RemoteTarget,
  onProgress?: (progress: RemoteSetupProgress) => void,
): Promise<{ ok: boolean; failure: string | null; home: string | null }> {
  const key = targetKey(target);
  const result = (channel: Channel) => {
    const { state, reason, home } = channel.snapshotWithHome();
    return state === 'ready'
      ? { ok: true, failure: null, home: home || null }
      : { ok: false, failure: reason, home: null };
  };
  const existing = channels.get(key);
  if (existing?.state === 'ready') return result(existing);
  // 在连或在重连：等它自己的那一轮跑完，不另起一条。
  if (existing && existing.state !== 'unavailable') {
    await existing.endpointFor().catch(() => {});
    return result(existing);
  }
  existing?.close();
  const channel = new Channel(target, broadcast, connector);
  channels.set(key, channel);
  await channel.connect('connecting', onProgress);
  return result(channel);
}

/** 放掉通道：只做本地收尾（停心跳、关隧道），远端实例靠空闲超时退出，任务照跑到那时。
 *  不带 target 是应用退出：所有连接都关。 */
export function closeHelper(target?: RemoteTarget): void {
  const keys = target ? [targetKey(target)] : [...channels.keys()];
  for (const key of keys) {
    channels.get(key)?.close();
    channels.delete(key);
  }
  broadcast();
}
