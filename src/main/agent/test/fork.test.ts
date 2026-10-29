// 会话分支：真实 Pi 会话加本地 mock 模型。已完成的回复带分支锚点；从中间一条回复分出的新会话只含
// 到那里为止的历史、沿用项目与模型；原会话的文件和正在用它的实例都不受影响。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-fork-'));
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

import {
  askSession,
  forkSession,
  newSession,
  openSession,
  preloadPi,
  shutdownSessions,
} from '../session';

const reply = (text: string) => ({
  kind: 'sse' as const,
  frames: [mockFrames.textDelta(text), mockFrames.finishFrame('stop')],
});
const ask = (id: string, text: string) =>
  askSession(id, { text, attachments: [], context: [], comments: [] });

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

it('从中间一条回复分支：新会话只含到那里为止的历史，原会话照常继续', async () => {
  const source = newSession(null, 'chat').sessionId!;
  server.enqueue(reply('first answer'));
  await ask(source, '第一问');
  server.enqueue(reply('second answer'));
  const asked = await ask(source, '第二问');

  const [, firstReply, , secondReply] = asked.messages;
  expect(firstReply?.entryId).toBeTruthy();
  expect(secondReply?.entryId).toBeTruthy();
  const sourceRow = state.db!.prepare('SELECT * FROM sessions WHERE id=?').get(source) as {
    file: string;
    cwd: string;
    title: string;
  };
  const before = readFileSync(sourceRow.file, 'utf8');

  const forked = await forkSession(source, firstReply!.entryId!);
  expect(forked.messages.map((message) => message.content)).toEqual(['第一问', 'first answer']);
  expect(forked).toMatchObject({ providerId: 'p1', model: 'mock-model', cwd: sourceRow.cwd });
  expect(
    state.db!.prepare('SELECT title, message_count FROM sessions WHERE id=?').get(forked.sessionId),
  ).toEqual({
    title: `分支：${sourceRow.title}`,
    message_count: 1,
  });
  expect(readFileSync(sourceRow.file, 'utf8')).toBe(before);

  server.enqueue(reply('third answer'));
  await ask(source, '第三问');
  expect(openSession(source).messages).toHaveLength(6);
  expect(openSession(forked.sessionId!).messages).toHaveLength(2);

  server.enqueue(reply('forked answer'));
  const continued = await ask(forked.sessionId!, '分支里接着问');
  expect(continued.messages.map((message) => message.content)).toEqual([
    '第一问',
    'first answer',
    '分支里接着问',
    'forked answer',
  ]);
  expect(readFileSync(sourceRow.file, 'utf8')).not.toContain('forked answer');
});

it('运行中的回复没有分支锚点', async () => {
  const id = newSession(null, 'chat').sessionId!;
  server.enqueue({
    kind: 'sse',
    frames: [
      mockFrames.textDelta('slow '),
      { ...mockFrames.textDelta('answer'), delayMs: 200 },
      mockFrames.finishFrame('stop'),
    ],
  });
  const running = ask(id, '慢一点');
  await vi.waitFor(() => expect(openSession(id).running).toBe(true));
  expect(openSession(id).messages.at(-1)?.entryId).toBeUndefined();
  expect((await running).messages.at(-1)?.entryId).toBeTruthy();
});
