// 真实 Pi 会话加本地 mock 模型。
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../llm-config';
import type { MockOpenAiServer, RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-sidechat-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
vi.mock('../providers', () => ({
  llmProviders: () => (state.provider ? [state.provider] : []),
  usableLlmProviders: () =>
    state.provider?.enabled && state.provider.apiKey ? [state.provider] : [],
}));
vi.mock('../environment', () => ({
  agentEnvironment: () => ({
    sessionOptions: async () => ({
      appendSystemPrompt: [],
      customTools: [],
      shellPath: process.env.SHELL ?? 'bash',
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: [],
    }),
  }),
}));

import { provideTestHostPorts } from '../../test/host-mock';
import { askInput as input, reply, startMockModel, stopMockModel } from '../../test/mock-model';
import { newSession, openSession } from '../session/commands';
import { askSession, invalidateSessions, shutdownSessions } from '../session/run';
import { preloadPi } from '../session/store';
import { askSidechat, closeSidechat, keepSidechat, openSidechat } from '../sidechat';

const sent = (request: RecordedRequest) =>
  (request.body as { messages: { content: unknown }[] }).messages.map((message) =>
    JSON.stringify(message.content),
  );
const fileOf = (id: string) =>
  (state.db!.prepare('SELECT file FROM sessions WHERE id=?').get(id) as { file: string }).file;
const rowCount = () =>
  (state.db!.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
const sessionFiles = () => readdirSync(join(root, 'pi', 'sessions'), { recursive: true }).length;

async function capture<T>(action: () => Promise<T>) {
  const requests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => requests.push(request));
  try {
    return { result: await action(), requests };
  } finally {
    stop();
  }
}

let server: MockOpenAiServer;

beforeAll(async () => {
  provideTestHostPorts({
    paths: { userData: () => root, home: () => root },
    database: () => state.db!,
  });
  const mock = await startMockModel();
  server = mock.server;
  state.provider = mock.provider;
  state.db = mock.db;
  await preloadPi();
});

afterAll(async () => {
  await shutdownSessions(1000);
  await stopMockModel({ server, db: state.db }, root);
});

it('旁问沿用主会话的系统提示与历史，不写文件、不进数据库，关闭即丢弃', async () => {
  const parent = newSession(null).sessionId!;
  server.enqueue(reply('main answer'));
  const main = await capture(() => askSession(parent, input('主问题')));
  const before = readFileSync(fileOf(parent), 'utf8');
  const files = sessionFiles();
  const rows = rowCount();

  expect((await openSidechat(parent)).messages).toEqual([]);
  server.enqueue(reply('side answer'));
  const side = await capture(() => askSidechat(parent, input('顺便问一下')));

  expect(side.result.messages.map((message) => message.content)).toEqual([
    '顺便问一下',
    'side answer',
  ]);
  // 主会话那次请求的全部消息（含系统提示）是旁问请求的前缀：提供商的前缀缓存能命中。
  const mainSent = sent(main.requests[0]!);
  expect(sent(side.requests[0]!).slice(0, mainSent.length)).toEqual(mainSent);
  expect(sent(side.requests[0]!).join('')).toContain('main answer');

  expect(readFileSync(fileOf(parent), 'utf8')).toBe(before);
  expect(sessionFiles()).toBe(files);
  expect(rowCount()).toBe(rows);
  expect(openSession(parent).messages).toHaveLength(2);

  await closeSidechat(parent);
  await expect(askSidechat(parent, input('还在吗'))).rejects.toThrow('旁问已关闭');
  expect((await openSidechat(parent)).messages).toEqual([]);
  await closeSidechat(parent);
});

it('保留旁问：成为带「旁问：」前缀的新会话，含借来的历史与旁问内容，之后各自继续', async () => {
  const parent = newSession(null).sessionId!;
  server.enqueue(reply('main answer'));
  await askSession(parent, input('主问题'));
  await openSidechat(parent);
  server.enqueue(reply('side answer'));
  await askSidechat(parent, input('旁问'));

  const kept = await keepSidechat(parent);
  expect(kept.messages.map((message) => message.content)).toEqual([
    '主问题',
    'main answer',
    '旁问',
    'side answer',
  ]);
  expect(
    state.db!.prepare('SELECT title, message_count FROM sessions WHERE id=?').get(kept.sessionId),
  ).toEqual({ title: '旁问：主问题', message_count: 2 });
  await expect(askSidechat(parent, input('还在吗'))).rejects.toThrow('旁问已关闭');

  server.enqueue(reply('kept answer'));
  expect((await askSession(kept.sessionId!, input('接着问'))).messages).toHaveLength(6);
  expect(openSession(parent).messages).toHaveLength(2);
});

it.each(['停用', '删除'] as const)('%s提供商后，已有旁问拒绝新请求并保留内容', async (action) => {
  const parent = newSession(null).sessionId!;
  server.enqueue(reply('main answer'));
  await askSession(parent, input('主问题'));
  await openSidechat(parent);
  server.enqueue(reply('side answer'));
  const before = await askSidechat(parent, input('旁问'));
  const provider = state.provider!;
  state.provider = action === '停用' ? { ...provider, enabled: false } : null;
  invalidateSessions(provider.id);
  try {
    const blocked = await capture(() =>
      expect(askSidechat(parent, input('不应发给旧服务的新内容'))).rejects.toThrow(),
    );
    expect(blocked.requests).toHaveLength(0);
    expect((await openSidechat(parent)).messages).toEqual(before.messages);
    const kept = await keepSidechat(parent);
    expect(kept.modelUnavailable).toBe(true);
    expect(kept.messages.map((message) => message.content)).toContain('side answer');
  } finally {
    state.provider = provider;
    await closeSidechat(parent);
  }
});
