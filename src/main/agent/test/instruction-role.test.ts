// 回归：发给 OpenAI 兼容端点的指令消息必须是 system 角色。
// 上游 Pi 在「模型开推理 + 它认为端点支持 developer 角色」时会把指令消息写成 developer；
// 而 Dela 的提供商（DeepSeek、智谱、MiniMax、致远与自定义网关）只认 system，会直接 422。
// Pi 的自动识别看的是提供商标识或 baseUrl 里的厂商域名，Dela 统一注册成 dela 识别不出来，
// 所以在 agent/pi.ts 里显式关掉了 supportsDeveloperRole——下面两条一起钉住这个结论。
import { describe, expect, it } from 'vitest';
import type { Model } from '@earendil-works/pi-ai';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

type OpenAiModel = Model<'openai-completions'>;

function modelFor(baseUrl: string, compat?: OpenAiModel['compat']): OpenAiModel {
  return {
    id: 'test-model',
    name: 'test-model',
    api: 'openai-completions',
    provider: 'dela',
    baseUrl,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 1024,
    ...(compat ? { compat } : {}),
  };
}

/** 发一次带系统指令的请求，返回服务端收到的第一条消息角色。 */
async function firstRole(compat?: OpenAiModel['compat']): Promise<string> {
  const server = await MockOpenAiServer.start();
  try {
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('ok'), mockFrames.finishFrame('stop')],
    });
    const { completeSimple } = await import('@earendil-works/pi-ai/compat');
    await completeSimple(
      modelFor(server.baseUrl, compat),
      {
        messages: [
          { role: 'system', content: '你是 Dela', timestamp: Date.now() },
          { role: 'user', content: '在吗', timestamp: Date.now() },
        ],
      },
      { apiKey: 'test-only', maxTokens: 64 },
    );
    const body = server.requests[0]?.body as { messages: { role: string }[] } | undefined;
    return body?.messages[0]?.role ?? '(没有请求)';
  } finally {
    await server.close();
  }
}

describe('指令消息的角色', () => {
  it('Dela 关掉 developer 角色后发的是 system', async () => {
    expect(await firstRole({ supportsDeveloperRole: false })).toBe('system');
  });

  it('不覆盖时上游会写 developer，这正是 422 的来源', async () => {
    expect(await firstRole()).toBe('developer');
  });
});
