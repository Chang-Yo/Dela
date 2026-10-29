// 旁问：真实 Pi 会话加本地 mock 模型。旁问带着主会话的上下文提问，不写文件也不进数据库；
// 主会话正在回答时只借到这一轮之前；保留后成为带「旁问：」前缀的新会话。
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-sidechat-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as unknown,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../providers', () => ({
  llmProviders: () => [state.provider],
  usableLlmProviders: () => [state.provider],
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
    workspaceRoot: () => root,
  }),
}));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
vi.mock('../extensions', () => ({
  bindSessionExtensions: async () => {},
  extensionCommand: () => false,
  releaseExtensionUi: () => {},
  sessionSlashCommands: () => [],
  shutdownSession: async (session: { dispose(): void }) => session.dispose(),
}));
vi.mock('../packages', () => ({ packagesEnabled: () => false }));

import { askSession, newSession, openSession, preloadPi, shutdownSessions } from '../session';
import { askSidechat, closeSidechat, keepSidechat, openSidechat } from '../sidechat';

const reply = (text: string, delayMs = 0) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text.slice(0, 1)),
    { ...mockFrames.textDelta(text.slice(1)), delayMs },
    mockFrames.finishFrame('stop'),
  ],
});
const input = (text: string) => ({ text, attachments: [], context: [], comments: [] });
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
  server = await MockOpenAiServer.start();
  state.provider = {
    id: 'p1',
    name: 'mock',
    baseUrl: server.baseUrl,
    apiKey: 'test-only',
    models: ['mock-model'],
    presetId: null,
    enabled: true,
  };
  state.db = new Database(':memory:');
  state.db.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
      kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT, file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      provider_id TEXT, model TEXT, effort TEXT);
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  await preloadPi();
});

afterAll(async () => {
  await shutdownSessions(1000);
  await server.close();
  state.db?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it('旁问沿用主会话的系统提示与历史，不写文件、不进数据库，关闭即丢弃', async () => {
  const parent = newSession(null, 'chat').sessionId!;
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

it('主会话正在回答时，旁问只借到这一轮提问之前', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  server.enqueue(reply('first answer'));
  await askSession(parent, input('第一问'));
  server.enqueue(reply('slow answer', 300));
  const running = askSession(parent, input('还在答的第二问'));
  await vi.waitFor(() => expect(openSession(parent).running).toBe(true));

  await openSidechat(parent);
  server.enqueue(reply('side answer'));
  const side = await capture(() => askSidechat(parent, input('旁问')));
  await running;

  // 主会话慢回答的请求也可能落在捕获窗口里：按最后一条消息认出旁问那次。
  const body = side.requests
    .map(sent)
    .find((messages) => messages.at(-1)?.includes('\\n旁问'))!
    .join('');
  expect(body).toContain('first answer');
  expect(body).not.toContain('还在答的第二问');
  await closeSidechat(parent);
});

it('保留旁问：成为带「旁问：」前缀的新会话，含借来的历史与旁问内容，之后各自继续', async () => {
  const parent = newSession(null, 'chat').sessionId!;
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
