// 后台任务的通知投递：真实 Pi 会话加本地 mock 模型。父会话运行中插进本轮（撤回插队消息也不丢），
// 空闲时自动开一轮且界面显示运行中，用户手动停止只追加不唤醒，主对话停止后结束的任务照常唤醒；
// 每个任务只投递一次。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../../credentials';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-task-notice-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
}));
vi.mock('electron', () => ({
  app: { getPath: () => root, isPackaged: false, getAppPath: () => root },
  shell: { trashItem: async () => {} },
}));
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
      shellPath: locateBash(),
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
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

import {
  askSession,
  cancelRun,
  newSession,
  openSession,
  preloadPi,
  sessionBranch,
  sessionRunning,
  shutdownSessions,
  withdrawQueued,
} from '../session';
import { sessionTurns } from '../session-read';
import { locateBash } from '../../terminal';
import { stopTask } from '../tasks';

const reply = (text: string, delayMs = 0) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text.slice(0, 1)),
    { ...mockFrames.textDelta(text.slice(1)), delayMs },
    mockFrames.finishFrame('stop'),
  ],
});
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
const input = (text: string) => ({ text, attachments: [], context: [], comments: [] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const recorded = () => {
  const requests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => requests.push(request));
  return { requests, stop };
};
const notices = (id: string) => openSession(id).messages.filter((message) => message.task);
const idle = (id: string) =>
  vi.waitFor(() => expect(sessionRunning(id)).toBe(false), { timeout: 10_000 });
const taskIdOf = (id: string) => {
  const step = openSession(id)
    .messages.flatMap((message) => message.toolResults ?? [])
    .findLast((result) => result.name === 'bash');
  return /taskId: ([\w-]+)/.exec(step!.output!.text!)![1]!;
};

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

it('父会话空闲时自动开一轮处理通知，界面显示运行中；只投递一次，会话读取里自成一轮', async () => {
  const parent = newSession(null, 'chat').sessionId!;
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

it('父会话运行中插进本轮；撤回插队消息时一并清掉的通知会重新插进去，仍只送达一次', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(backgroundBash('sleep 0.2; echo 很快'));
  server.enqueue(reply('先等等', 1500));
  server.enqueue(reply('收到通知'));
  const turn = askSession(parent, input('跑个快的'));
  await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 10_000 });
  await sleep(700);
  withdrawQueued(parent);
  await turn;
  await sleep(300);
  stop();

  expect(requests).toHaveLength(3);
  const body = JSON.stringify(requests[2]!.body);
  expect(body).toContain('很快');
  expect(body.split('后台任务结束').length - 1).toBe(1);
  const [notice, ...rest] = notices(parent);
  expect(rest).toHaveLength(0);
  expect(notice!.task!.turnId).toBeUndefined();
  expect(openSession(parent).messages.at(-1)).toMatchObject({ content: '收到通知' });
});

it('用户手动停止的任务只把通知追加进记录，不唤醒父会话', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(backgroundBash('sleep 30'));
  server.enqueue(reply('跑起来了'));
  await askSession(parent, input('跑个慢的'));
  const taskId = taskIdOf(parent);
  stopTask(taskId, 'user');
  await vi.waitFor(() => expect(notices(parent)).toHaveLength(1), { timeout: 10_000 });
  await sleep(300);
  stop();

  expect(requests).toHaveLength(2);
  expect(sessionRunning(parent)).toBe(false);
  expect(notices(parent)[0]!.task).toMatchObject({ taskId, status: 'stopped' });
});

it('主对话停止不影响后台任务，之后正常结束的任务仍会唤醒父会话', async () => {
  const parent = newSession(null, 'chat').sessionId!;
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
