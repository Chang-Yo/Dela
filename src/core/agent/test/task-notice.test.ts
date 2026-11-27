// 真实 Pi 会话加本地 mock 模型。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../llm-config';
import { mockFrames, type MockOpenAiServer, type RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-task-notice-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
}));
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false, getAppPath: () => root },
}));
vi.mock('../providers', () => ({
  llmProviders: () => (state.provider ? [state.provider] : []),
  usableLlmProviders: () => (state.provider ? [state.provider] : []),
}));
vi.mock('../environment', () => ({
  agentEnvironment: () => ({
    sessionOptions: async () => ({
      appendSystemPrompt: [],
      customTools: [],
      shellPath: testBash(),
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: [],
    }),
  }),
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

import { newSession, openSession } from '../session/commands';
import { sessionBranch, sessionRunning } from '../session/live';
import { askSession, cancelRun, shutdownSessions } from '../session/run';
import { preloadPi } from '../session/store';
import { sessionTurns } from '../session-read';
import { testBash } from '../../test/bash';
import { provideTestHostPorts } from '../../test/host-mock';
import {
  askInput as input,
  recordRequests,
  reply,
  startMockModel,
  stopMockModel,
} from '../../test/mock-model';

provideTestHostPorts({ database: () => state.db!, paths: { bash: testBash } });

const backgroundBash = (command: string) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.toolCallDelta({
      index: 0,
      id: `call-${Date.now()}`,
      name: 'bash',
      arguments: JSON.stringify({ command, background: true }),
    }),
    mockFrames.finishFrame('tool_calls'),
  ],
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idle = (id: string) =>
  vi.waitFor(() => expect(sessionRunning(id)).toBe(false), { timeout: 10_000 });
let server: MockOpenAiServer;
const recorded = () => recordRequests(server);

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

it('父会话空闲时自动开一轮处理通知，界面显示运行中；只投递一次，会话读取里自成一轮', async () => {
  const parent = newSession(null).sessionId!;
  const requests: RecordedRequest[] = [];
  let runningAtWake = false;
  const stop = server.onRequest((request) => {
    requests.push(request);
    if (requests.length === 3) runningAtWake = sessionRunning(parent);
  });
  server.enqueue(backgroundBash('sleep 0.3; echo 构建完成'));
  server.enqueue(reply('已在后台构建'));
  server.enqueue(reply('构建好了'));
  await askSession(parent, input('后台跑构建'));
  expect(requests).toHaveLength(2);
  await vi.waitFor(() => expect(requests).toHaveLength(3), { timeout: 10_000 });
  await idle(parent);
  await sleep(300);
  stop();

  expect(runningAtWake).toBe(true);
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests[2]!.body)).toContain('构建完成');
  const messages = openSession(parent).messages;
  const notice = messages.find((message) => message.task);
  expect(messages.filter((message) => message.task)).toHaveLength(1);
  expect(notice!.task).toMatchObject({ kind: 'bash', status: 'completed' });
  expect(JSON.stringify(requests[2]!.body)).toContain('后台任务结束');
  expect(notice!.content).toBe('```\n构建完成\n```');
  expect(messages[messages.indexOf(notice!) + 1]).toMatchObject({
    role: 'assistant',
    content: '构建好了',
    turnId: notice!.task!.turnId,
  });
  const last = sessionTurns(sessionBranch(parent).branch).at(-1)!;
  expect(last).toMatchObject({
    turnId: notice!.task!.turnId,
    reply: '构建好了',
    status: 'completed',
  });
  expect(last.user).toContain('后台任务结束');
});

it('主对话停止不影响后台任务，之后正常结束的任务仍会唤醒父会话', async () => {
  const parent = newSession(null).sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(backgroundBash('sleep 1; echo 迟到的结果'));
  server.enqueue(reply('慢慢说', 3000));
  const turn = askSession(parent, input('跑完再说'));
  await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 10_000 });
  cancelRun(parent);
  await turn;
  server.enqueue(reply('看到迟到的结果'));
  await vi.waitFor(() => expect(requests).toHaveLength(3), { timeout: 10_000 });
  await idle(parent);
  stop();

  expect(JSON.stringify(requests[2]!.body)).toContain('迟到的结果');
  expect(openSession(parent).messages.at(-1)).toMatchObject({ content: '看到迟到的结果' });
});
