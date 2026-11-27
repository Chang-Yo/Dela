// 真实 Pi 会话加本地 mock 模型。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { MockOpenAiServer } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-fork-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as unknown,
}));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
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
  }),
}));

import { provideTestHostPorts } from '../../test/host-mock';
import { reply, startMockModel, stopMockModel } from '../../test/mock-model';

import { forkSession, newSession, openSession } from '../session/commands';
import { askSession, shutdownSessions } from '../session/run';
import { preloadPi } from '../session/store';

const ask = (id: string, text: string) =>
  askSession(id, { text, attachments: [], context: [], comments: [] });

let server: MockOpenAiServer;

beforeAll(async () => {
  provideTestHostPorts({ paths: { userData: () => root }, database: () => state.db! });
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

it('从中间一条回复分支：新会话只含到那里为止的历史，原会话照常继续', async () => {
  const source = newSession(null).sessionId!;
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
