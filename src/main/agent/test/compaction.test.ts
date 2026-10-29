// /compact 依赖的 Pi 行为：手动压缩发 compaction_start / compaction_end，结果里带 estimatedTokensAfter；
// 压缩后模型回复前 Pi 给不出上下文用量（tokens 为 null），Dela 用估计值顶上。真实 Pi 会话，本地 mock 模型。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-compaction-'));
vi.mock('electron', () => ({ app: { getPath: () => root } }));
vi.mock('../../database', () => ({ getDatabase: () => null }));
vi.mock('../providers', () => ({ llmProviders: () => [], usableLlmProviders: () => [] }));
vi.mock('../environment', () => ({ agentEnvironment: () => ({}) }));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
vi.mock('../extensions', () => ({}));
vi.mock('../packages', () => ({}));

import { openPiSession } from '../pi';
import { contextUsageView } from '../session';

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const reply = (text: string) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text),
    mockFrames.usageFrame(12_000, 50),
    mockFrames.finishFrame('stop'),
  ],
});

it('manual compaction reports an estimate and leaves actual usage unknown until the next reply', async () => {
  const server = await MockOpenAiServer.start();
  const session = await openPiSession({
    cwd: mkdtempSync(join(root, 'cwd-')),
    selection: {
      provider: {
        id: 'p',
        name: 'mock',
        baseUrl: server.baseUrl,
        apiKey: 'test-only',
        models: ['mock-model'],
        presetId: null,
        enabled: true,
      },
      model: 'mock-model',
      effort: null,
    },
    appendSystemPrompt: [],
    customTools: [],
    shellPath: process.env.SHELL ?? 'bash',
    skillPaths: [],
    globalSkillDirs: [],
    disabledSkills: new Set(),
    disabledTools: [],
  });
  const events: AgentSessionEvent[] = [];
  const unsubscribe = session.subscribe((event) => events.push(event));
  try {
    // 太短的对话 Pi 拒绝压缩：Dela 把这句换成「对话还太短」。
    await expect(session.compact()).rejects.toThrow(/Nothing to compact/);

    // 攒够超过 Pi 默认保留量（最近约 2 万 token）的历史，才有东西可压缩。
    for (let index = 0; index < 3; index++) {
      server.enqueue(reply(`answer ${index}`));
      await session.prompt(`${index} ${'lorem ipsum '.repeat(4_000)}`);
    }
    for (let index = 0; index < 3; index++) server.enqueue(reply(`summary ${index}`));
    const result = await session.compact('keep the decisions');

    expect(events.some((event) => event.type === 'compaction_start')).toBe(true);
    const end = events.find((event) => event.type === 'compaction_end');
    expect(end).toMatchObject({ reason: 'manual', aborted: false });
    expect(result.estimatedTokensAfter).toBeGreaterThan(0);

    const stats = session.getSessionStats();
    expect(stats.contextUsage?.tokens).toBeNull();
    expect(contextUsageView(stats, result.estimatedTokensAfter)).toMatchObject({
      tokens: result.estimatedTokensAfter,
      estimated: true,
    });

    // 压缩说明随请求发给模型。
    expect(JSON.stringify(server.requests.at(-1)?.body)).toContain('keep the decisions');
  } finally {
    unsubscribe();
    session.dispose();
    await server.close();
  }
}, 60_000);
