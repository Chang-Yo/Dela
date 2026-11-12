import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 可编程的本地 OpenAI 兼容 SSE mock 服务（Pi Agent Core 桥接层测试用）：按序返回脚本化响应，
 * 记录请求的 URL、认证头与请求体；密钥固定为测试占位值，不涉及真实数据。
 */

/** delayMs 用于制造慢流，配合中断测试。 */
export interface SseFrame {
  data: unknown;
  delayMs?: number;
}

export type ScriptedResponse =
  { kind: 'sse'; frames: SseFrame[] } | { kind: 'status'; status: number; json?: unknown };

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

const textDelta = (text: string): SseFrame => ({
  data: { choices: [{ index: 0, delta: { content: text } }] },
});

const reasoningDelta = (text: string): SseFrame => ({
  data: { choices: [{ index: 0, delta: { reasoning_content: text } }] },
});

/** OpenAI 线格式：name/arguments 嵌在 function 下，分片增量按 index 聚合。 */
const toolCallDelta = (part: {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}): SseFrame => ({
  data: {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: part.index,
              ...(part.id !== undefined ? { id: part.id, type: 'function' as const } : {}),
              ...(part.name !== undefined || part.arguments !== undefined
                ? {
                    function: {
                      ...(part.name !== undefined ? { name: part.name } : {}),
                      ...(part.arguments !== undefined ? { arguments: part.arguments } : {}),
                    },
                  }
                : {}),
            },
          ],
        },
      },
    ],
  },
});

const finishFrame = (reason: string): SseFrame => ({
  data: { choices: [{ index: 0, delta: {}, finish_reason: reason }] },
});

const usageFrame = (input: number, output: number): SseFrame => ({
  data: { choices: [], usage: { prompt_tokens: input, completion_tokens: output } },
});

export const mockFrames = { textDelta, reasoningDelta, toolCallDelta, finishFrame, usageFrame };

export class MockOpenAiServer {
  readonly requests: RecordedRequest[] = [];
  private readonly server: Server;
  private readonly queue: ScriptedResponse[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly listeners = new Set<(request: RecordedRequest) => void>();
  private closed = false;

  private constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  static async start(): Promise<MockOpenAiServer> {
    const instance = new MockOpenAiServer();
    await new Promise<void>((resolve) => {
      instance.server.listen(0, '127.0.0.1', resolve);
    });
    return instance;
  }

  /** OpenAI 兼容 baseUrl：SDK 会在此基础上拼接 /chat/completions。 */
  get baseUrl(): string {
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/v1`;
  }

  enqueue(response: ScriptedResponse): void {
    this.queue.push(response);
  }

  /** 每用例独立捕获：共享 requests 数组的按位切片存在跨用例竞态窗口，需要精确归属的
   *  断言（如逐请求校验字段）改用监听器只收本用例运行期间到达的请求。 */
  onRequest(listener: (request: RecordedRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // 连接被客户端中断（abort 测试）时避免 response 上的未处理 error 冒泡。
    response.on('error', () => {});
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      body = undefined;
    }
    const recorded: RecordedRequest = {
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization ?? null,
      body,
    };
    this.requests.push(recorded);
    for (const listener of this.listeners) listener(recorded);
    const scripted = this.queue.shift();
    if (!scripted) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'mock: no scripted response' } }));
      return;
    }
    if (scripted.kind === 'status') {
      response.writeHead(scripted.status, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify(scripted.json ?? { error: { message: `mock ${scripted.status}` } }),
      );
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    for (const frame of scripted.frames) {
      if (frame.delayMs) await this.delay(frame.delayMs);
      // 客户端 abort 会销毁连接：跳过后续写入，避免向已销毁流写入
      if (this.closed || response.destroyed || response.writableEnded) return;
      response.write(
        `data: ${typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data)}\n\n`,
      );
    }
    response.write('data: [DONE]\n\n');
    response.end();
  }
}
