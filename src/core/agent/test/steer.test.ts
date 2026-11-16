// 插队：真实 Pi 会话加本地 mock 模型。运行中发来的消息在当前回复结束后、下一次调用模型前送达，
// 沿用本轮 turnId；停止或撤回时还没送达的交回输入框。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../llm-config';
import type { MockOpenAiServer, RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-steer-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
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
  }),
}));
import { newSession, openSession } from '../session/commands';
import { askSession, cancelRun, shutdownSessions, withdrawQueued } from '../session/run';
import { preloadPi } from '../session/store';
import { readChatAttachment, stageChatMedia } from '../media';
import { provideTestHostPorts } from '../../test/host-mock';
import { askInput as input, reply, startMockModel, stopMockModel } from '../../test/mock-model';

provideTestHostPorts({ database: () => state.db! });

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

async function startSlowTurn(id: string) {
  server.enqueue(reply('first', 500));
  const started = nextRequest();
  const turn = askSession(id, input('先做 A'));
  await started;
  return { turn };
}

let server: MockOpenAiServer;

beforeAll(async () => {
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

it('运行中发送的消息插进本轮：当前回复结束后送达模型，沿用本轮 turnId，附件到轮末才释放', async () => {
  const id = newSession(null).sessionId!;
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

it('停止时还没送达的插队消息连同附件、评论交回输入框，不发给模型', async () => {
  const id = newSession(null).sessionId!;
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
  const id = newSession(null).sessionId!;
  const { turn: first } = await startSlowTurn(id);
  await askSession(id, input('顺便做 B'));
  await askSession(id, input('再做 C'));

  expect(withdrawQueued(id)).toEqual({ text: '顺便做 B\n\n再做 C', comments: [], attachments: [] });
  expect(withdrawQueued(id)).toBeNull();
  await first;

  expect(contents(id)).toEqual(['先做 A', 'first']);
}, 30_000);
