// 插队：真实 Pi 会话加本地 mock 模型。运行中发来的消息在当前回复结束后、下一次调用模型前送达，
// 沿用本轮 turnId；Dela 收尾时发来的作为新一轮；停止或撤回时还没送达的交回输入框。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../../credentials';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-steer-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
  freezeGate: null as Promise<void> | null,
  freezing: false,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../providers', () => ({
  llmProviders: () => (state.provider ? [state.provider] : []),
  usableLlmProviders: () => (state.provider ? [state.provider] : []),
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
// 冻结改动是收尾的第一步：拦在这里，就能在「Pi 已答完、Dela 还在收尾」的窗口里发消息。
vi.mock('../changes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../changes')>();
  return {
    ...actual,
    freezeTurnChanges: async (...args: Parameters<typeof actual.freezeTurnChanges>) => {
      state.freezing = true;
      await state.freezeGate;
      return actual.freezeTurnChanges(...args);
    },
  };
});

import {
  askSession,
  cancelRun,
  newSession,
  openSession,
  preloadPi,
  shutdownSessions,
  withdrawQueued,
} from '../session';
import { readChatAttachment, stageChatMedia } from '../media';

const reply = (text: string, delayMs = 0) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text.slice(0, 1)),
    { ...mockFrames.textDelta(text.slice(1)), delayMs },
    mockFrames.finishFrame('stop'),
  ],
});
const input = (text: string, attachments: string[] = []) => ({
  text,
  attachments,
  context: [],
  comments: [],
});
const contents = (id: string) => openSession(id).messages.map((message) => message.content);
const userTurns = (id: string) =>
  openSession(id)
    .messages.filter((message) => message.role === 'user')
    .map(({ content, turnId }) => ({ content, turnId }));
const lastRequest = () => JSON.stringify(server.requests.at(-1)?.body);
const nextRequest = () =>
  new Promise<RecordedRequest>((resolve) => {
    const stop = server.onRequest((request) => {
      stop();
      resolve(request);
    });
  });

/** 开一轮慢回复，等模型开始回答（Pi 正在运行）再返回；包一层，免得 await 把整轮也等完。 */
async function startSlowTurn(id: string) {
  server.enqueue(reply('first', 500));
  const started = nextRequest();
  const turn = askSession(id, input('先做 A'));
  await started;
  return { turn };
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
      provider_id TEXT, model TEXT, effort TEXT, parent_id TEXT);
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

it('运行中发送的消息插进本轮：当前回复结束后送达模型，沿用本轮 turnId，附件到轮末才释放', async () => {
  const id = newSession(null, 'chat').sessionId!;
  const note = stageChatMedia('note.txt', Buffer.from('附件内容'));
  const { turn: first } = await startSlowTurn(id);
  server.enqueue(reply('second'));

  const steered = await askSession(id, input('顺便做 B', [note.id]));
  expect(steered.running).toBe(true);
  expect(steered.queued).toEqual(['顺便做 B']);
  await first;

  expect(contents(id)).toEqual(['先做 A', 'first', '顺便做 B', 'second']);
  const [asked, inserted] = userTurns(id);
  expect(inserted!.turnId).toBe(asked!.turnId);
  expect(lastRequest()).toContain('顺便做 B');
  expect(lastRequest()).toContain('附件内容');
  expect(openSession(id).queued).toEqual([]);
  expect(() => readChatAttachment(note.id)).toThrow();
}, 30_000);

it('Pi 已答完、Dela 还在收尾时发来的消息，等收尾结束后作为新一轮发出', async () => {
  const id = newSession(null, 'chat').sessionId!;
  let release!: () => void;
  state.freezeGate = new Promise((resolve) => {
    release = resolve;
  });
  state.freezing = false;
  server.enqueue(reply('first'));
  const first = askSession(id, input('先做 A'));
  await vi.waitFor(() => expect(state.freezing).toBe(true));

  server.enqueue(reply('second'));
  const second = askSession(id, input('再做 B'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(userTurns(id).map(({ content }) => content)).toEqual(['先做 A']);

  state.freezeGate = null;
  release();
  await first;
  await second;

  expect(contents(id)).toEqual(['先做 A', 'first', '再做 B', 'second']);
  const [asked, next] = userTurns(id);
  expect(next!.turnId).toBeDefined();
  expect(next!.turnId).not.toBe(asked!.turnId);
}, 30_000);

it('停止时还没送达的插队消息连同附件、评论交回输入框，不发给模型', async () => {
  const id = newSession(null, 'chat').sessionId!;
  const note = stageChatMedia('note.txt', Buffer.from('附件内容'));
  const comments = [{ quote: '原文', comment: '改一下' }];
  const { turn: first } = await startSlowTurn(id);
  await askSession(id, { ...input('顺便做 B', [note.id]), comments });

  expect(cancelRun(id)).toEqual({
    text: '顺便做 B',
    comments,
    attachments: [
      { id: note.id, name: 'note.txt', size: note.size, kind: 'attachment', previewUrl: null },
    ],
  });
  await first;

  expect(userTurns(id).map(({ content }) => content)).toEqual(['先做 A']);
  expect(openSession(id).queued).toEqual([]);
  expect(lastRequest()).not.toContain('顺便做 B');
  // 交回输入框的附件还要重新发送，轮末不能释放。
  expect(readChatAttachment(note.id).name).toBe('note.txt');
}, 30_000);

it('撤回插队消息后本轮照常答完', async () => {
  const id = newSession(null, 'chat').sessionId!;
  const { turn: first } = await startSlowTurn(id);
  await askSession(id, input('顺便做 B'));
  await askSession(id, input('再做 C'));

  expect(withdrawQueued(id)).toEqual({ text: '顺便做 B\n\n再做 C', comments: [], attachments: [] });
  expect(withdrawQueued(id)).toBeNull();
  await first;

  expect(contents(id)).toEqual(['先做 A', 'first']);
}, 30_000);
