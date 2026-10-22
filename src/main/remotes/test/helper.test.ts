// helper 通道的状态机与任务接回：用本机 HTTP 假扮远端 helper，「隧道」是一个可以随时杀掉的子进程。
// 引导、上传、真隧道与真 helper 在 helper.remote.test.ts，由 pnpm test:remote 运行。
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

import type { RemoteChannelState } from '../../../shared/remotes';
import {
  closeHelper,
  helperSession,
  HelperUnavailableError,
  onHelperState,
  readyHelper,
  retryHelper,
  setConnectorForTesting,
} from '../helper';

const token = 'test-token-0123456789';

interface FakeTask {
  output: Buffer;
  exit: { state: string; code: number } | null;
  listeners: Set<() => void>;
  creates: number;
}

/** 假 helper：只实现这里用到的几个端点，任务输出由测试手动追加。 */
class FakeHelper {
  server: Server;
  port = 0;
  tasks = new Map<string, FakeTask>();
  /** 正在开着的任务流：模拟隧道断时一起掐掉。 */
  streams = new Set<ServerResponse>();
  lists = 0;

  constructor() {
    this.server = createServer((request, response) => this.handle(request, response));
  }

  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  dropStreams() {
    for (const response of this.streams) response.destroy();
    this.streams.clear();
  }

  append(id: string, text: string) {
    const task = this.tasks.get(id)!;
    task.output = Buffer.concat([task.output, Buffer.from(text)]);
    for (const listener of task.listeners) listener();
  }

  finish(id: string, code: number) {
    const task = this.tasks.get(id)!;
    task.exit = { state: 'exited', code };
    for (const listener of task.listeners) listener();
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    const url = new URL(request.url!, 'http://x');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    const json = (value: unknown) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === '/v1/hello') return json({ protocol: 2, helperVersion: '0.3.0' });
    if (url.pathname === '/v1/heartbeat') return json({ ok: true });
    if (url.pathname === '/v1/fs/list') {
      this.lists += 1;
      return json({ entries: [{ name: 'a.txt', directory: false, size: 1, modifiedAt: 0 }] });
    }
    if (url.pathname === '/v1/tasks' && request.method === 'POST') {
      const { id } = JSON.parse(body) as { id: string };
      let task = this.tasks.get(id);
      if (!task) {
        task = { output: Buffer.alloc(0), exit: null, listeners: new Set(), creates: 0 };
        this.tasks.set(id, task);
      }
      task.creates += 1;
      return json({ task: { id }, created: task.creates === 1 });
    }
    const stream = /^\/v1\/tasks\/([^/]+)\/stream$/.exec(url.pathname);
    if (stream) {
      const task = this.tasks.get(stream[1]!)!;
      let offset = Number(url.searchParams.get('offset') ?? 0);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      this.streams.add(response);
      const pump = () => {
        if (offset < task.output.length) {
          const data = task.output.subarray(offset).toString('base64');
          response.write(`data: ${JSON.stringify({ type: 'output', offset, data })}\n\n`);
          offset = task.output.length;
        }
        if (task.exit) {
          response.end(`data: ${JSON.stringify({ type: 'exit', ...task.exit })}\n\n`);
          task.listeners.delete(pump);
          this.streams.delete(response);
        }
      };
      task.listeners.add(pump);
      response.on('close', () => task.listeners.delete(pump));
      pump();
      return;
    }
    response.writeHead(404).end('{}');
  }
}

/** 一个什么都不做、但能被杀掉的「隧道进程」。 */
function fakeTunnel(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

const target = { host: 'user@10.0.0.5', keyPath: null };
let helper: FakeHelper;
let tunnels: ChildProcess[];
let connects: number;
let failNext: string | null;

beforeEach(async () => {
  helper = new FakeHelper();
  await helper.start();
  tunnels = [];
  connects = 0;
  failNext = null;
  setConnectorForTesting(async () => {
    connects += 1;
    if (failNext) throw new Error(failNext);
    const tunnel = fakeTunnel();
    tunnels.push(tunnel);
    return { endpoint: { port: helper.port, token }, process: tunnel, home: '/home/u' };
  });
});

afterEach(async () => {
  closeHelper();
  setConnectorForTesting(null);
  for (const tunnel of tunnels) tunnel.kill();
  await new Promise<void>((resolve) => helper.server.close(() => resolve()));
  vi.useRealTimers();
});

/** 杀掉当前「隧道」：通道应进入重连，并把在跑的任务流一起断掉（真隧道断时就是这样）。 */
function cutTunnel() {
  helper.dropStreams();
  tunnels.at(-1)!.kill();
}

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('通道状态机', () => {
  it('会话对象跨重连不变，隧道断后请求排队等通道回来', async () => {
    const session = await readyHelper(target);
    expect(await session.list('/p')).toHaveLength(1);
    cutTunnel();
    // 隧道一断就发：请求可能撞上「还没察觉断开」或「正在重连」，两种都该等到新隧道而不是失败。
    expect(await helperSession(target).list('/p')).toHaveLength(1);
    await waitFor(() => connects === 2);
    expect(await session.list('/p')).toHaveLength(1);
    expect(helperSession(target)).toBe(session);
  });

  it('首次引导失败就判为不可用，带原因推给渲染端，调用直接报错', async () => {
    failNext = 'helper 启动失败（诊断：noexec）';
    const states: RemoteChannelState[][] = [];
    const stop = onHelperState((snapshot) => states.push(snapshot));
    await expect(readyHelper(target)).rejects.toBeInstanceOf(HelperUnavailableError);
    await expect(helperSession(target).list('/p')).rejects.toThrow('noexec');
    expect(states.at(-1)).toEqual([
      {
        destination: target.host,
        state: 'unavailable',
        reason: 'helper 启动失败（诊断：noexec）',
        since: expect.any(Number),
      },
    ]);
    // 不可用后短时间内不会反复去起远端进程。
    expect(connects).toBe(1);
    stop();
  });

  it('手动重试不等自动重试的间隔，原因消失后恢复可用', async () => {
    failNext = '认证失败';
    await expect(readyHelper(target)).rejects.toBeInstanceOf(HelperUnavailableError);
    failNext = null;
    expect((await retryHelper(target)).state).toBe('ready');
    expect(await helperSession(target).list('/p')).toHaveLength(1);
    expect(connects).toBe(2);
  });

  it('重连期间推 reconnecting，回来后推 ready', async () => {
    await readyHelper(target);
    const seen: string[] = [];
    const stop = onHelperState((snapshot) => seen.push(snapshot[0]!.state));
    cutTunnel();
    await waitFor(() => seen.at(-1) === 'ready' && seen.includes('reconnecting'));
    stop();
  });
});

describe('任务接回', () => {
  it('隧道断在任务中途：重连后从断点续读，命令只创建一次', async () => {
    const session = await readyHelper(target);
    const chunks: string[] = [];
    const running = session.exec('make', {
      cwd: '/p',
      onData: (chunk) => chunks.push(chunk.toString()),
    });
    await waitFor(() => helper.tasks.size === 1);
    const id = [...helper.tasks.keys()][0]!;
    helper.append(id, 'first\n');
    await waitFor(() => chunks.join('') === 'first\n');

    cutTunnel();
    // 断线期间任务继续产出。
    helper.append(id, 'second\n');
    await waitFor(() => connects === 2);
    helper.finish(id, 7);

    const result = await running;
    expect(chunks.join('')).toBe('first\nsecond\n');
    expect(result).toEqual({ code: 7, state: 'exited', lost: 0 });
    expect(helper.tasks.get(id)!.creates).toBe(1);
  });

  it('取消会显式告诉 helper，而不是只断开本地连接', async () => {
    const session = await readyHelper(target);
    const cancelled: string[] = [];
    const original = helper.server.listeners('request')[0] as (
      request: IncomingMessage,
      response: ServerResponse,
    ) => void;
    helper.server.removeAllListeners('request');
    helper.server.on('request', (request, response) => {
      const match = /^\/v1\/tasks\/([^/]+)\/cancel$/.exec(request.url ?? '');
      if (match) {
        cancelled.push(match[1]!);
        response.writeHead(200).end('{}');
        return;
      }
      original(request, response);
    });
    const controller = new AbortController();
    const running = session.exec('sleep 60', { cwd: '/p', signal: controller.signal });
    await waitFor(() => helper.tasks.size === 1);
    controller.abort();
    await expect(running).rejects.toThrow('aborted');
    await waitFor(() => cancelled.length === 1);
    expect(cancelled[0]).toBe([...helper.tasks.keys()][0]);
  });
});
