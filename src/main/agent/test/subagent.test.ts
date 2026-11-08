// 子 Agent（task 工具）：真实 Pi 会话加本地 mock 模型。子会话历史为空、工具里没有 task，
// 只把最终回复交回父会话；带 taskId 续接；父会话停止时连带中止；并发数超出上限时直接报错；
// 在内置能力里关掉后不再提供。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { StoredLlmProvider } from '../../credentials';
import type { SubagentDetails } from '../../../shared/api';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

const root = mkdtempSync(join(tmpdir(), 'dela-subagent-'));
const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  provider: null as StoredLlmProvider | null,
  disabledTools: [] as string[],
}));
vi.mock('electron', () => ({
  app: { getPath: () => root },
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
      shellPath: process.env.SHELL ?? 'bash',
      skillPaths: [],
      globalSkillDirs: [],
      disabledSkills: new Set(),
      disabledTools: state.disabledTools,
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
  cancelRun,
  deleteSession,
  listSessions,
  newSession,
  openSession,
  preloadPi,
  shutdownSessions,
  updateSessionVisibility,
} from '../session';

const reply = (text: string, delayMs = 0) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.textDelta(text.slice(0, 1)),
    { ...mockFrames.textDelta(text.slice(1)), delayMs },
    mockFrames.finishFrame('stop'),
  ],
});
const taskCalls = (...calls: object[]) => ({
  kind: 'sse' as const,
  frames: [
    ...calls.map((args, index) =>
      mockFrames.toolCallDelta({
        index,
        id: `call-${index}-${Date.now()}`,
        name: 'task',
        arguments: JSON.stringify(args),
      }),
    ),
    mockFrames.finishFrame('tool_calls'),
  ],
});
const input = (text: string) => ({ text, attachments: [], context: [], comments: [] });
const toolNames = (request: RecordedRequest) =>
  ((request.body as { tools?: { function: { name: string } }[] }).tools ?? []).map(
    (tool) => tool.function.name,
  );
const children = (parentId: string) =>
  (
    state
      .db!.prepare('SELECT id FROM sessions WHERE parent_id=? ORDER BY created_at')
      .all(parentId) as { id: string }[]
  ).map(({ id }) => id);
/** 父会话里 task 工具的结果（按调用顺序）。 */
const taskResults = (parentId: string) =>
  openSession(parentId)
    .messages.flatMap((message) => message.parts ?? [])
    .flatMap((part) => (part.type === 'tools' ? part.results : []))
    .filter((result) => result.name === 'task');
const recorded = () => {
  const requests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => requests.push(request));
  return { requests, stop };
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

it('子 Agent 历史为空、没有 task 工具，只把最终回复交回父会话；续接时保留它自己的对话', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(taskCalls({ description: '整理笔记', prompt: '列出第三章要点' }));
  server.enqueue(reply('要点：极限、连续'));
  server.enqueue(reply('已整理'));
  await askSession(parent, input('帮我派人整理笔记'));
  stop();

  const [parentAsk, childAsk, parentFinal] = requests;
  expect(toolNames(parentAsk!)).toContain('task');
  expect(toolNames(childAsk!)).not.toContain('task');
  expect(JSON.stringify(childAsk!.body)).toContain('列出第三章要点');
  expect(JSON.stringify(childAsk!.body)).not.toContain('帮我派人整理笔记');
  expect(JSON.stringify(parentFinal!.body)).toContain('要点：极限、连续');

  const [child] = children(parent);
  expect(taskResults(parent)[0]!.output?.details).toMatchObject({
    taskId: child,
    status: 'completed',
    reply: '要点：极限、连续',
  } satisfies Partial<SubagentDetails>);
  expect(openSession(child!)).toMatchObject({
    subagent: { parentId: parent, description: '整理笔记' },
    running: false,
  });
  expect(listSessions(null, '').map(({ id }) => id)).not.toContain(child);
  await expect(askSession(child!, input('直接问子会话'))).rejects.toThrow('只读');

  const resumed = recorded();
  server.enqueue(taskCalls({ description: '追问', prompt: '再补充例题', taskId: child }));
  server.enqueue(reply('例题：洛必达'));
  server.enqueue(reply('补充好了'));
  await askSession(parent, input('让它再补充例题'));
  resumed.stop();
  expect(JSON.stringify(resumed.requests[1]!.body)).toContain('要点：极限、连续');
  expect(children(parent)).toEqual([child]);

  const foreign = recorded();
  server.enqueue(taskCalls({ description: '乱续', prompt: '…', taskId: 'not-a-task' }));
  server.enqueue(reply('知道了'));
  await askSession(parent, input('续接一个不存在的'));
  foreign.stop();
  expect(JSON.stringify(foreign.requests[1]!.body)).toContain('没有这个子 Agent');
});

it('父会话停止时连带中止子 Agent，子会话保留并记为停止', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  server.enqueue(taskCalls({ description: '慢任务', prompt: '慢慢做' }));
  server.enqueue(reply('做到一半', 3000));
  let childAsked!: () => void;
  const asked = new Promise<void>((resolve) => (childAsked = resolve));
  let count = 0;
  const stop = server.onRequest(() => {
    if (++count === 2) childAsked();
  });
  const turn = askSession(parent, input('派个慢任务'));
  await asked;
  stop();
  cancelRun(parent);
  await turn;

  const [child] = children(parent);
  const view = openSession(child!);
  expect(view.running).toBe(false);
  expect(view.messages.at(-1)).toMatchObject({ role: 'assistant', stopped: true });
  expect(taskResults(parent)[0]!.output).toMatchObject({
    isError: true,
    details: { taskId: child, status: 'stopped' },
  });
});

it('在内置能力里关掉 task 后，新会话没有 task 工具，后台 bash 照常可用', async () => {
  state.disabledTools = ['task'];
  const parent = newSession(null, 'chat').sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(reply('好的'));
  await askSession(parent, input('你好'));
  stop();
  state.disabledTools = [];

  expect(toolNames(requests[0]!)).not.toContain('task');
  expect(toolNames(requests[0]!)).toEqual(
    expect.arrayContaining(['bash', 'task_output', 'task_stop']),
  );
});

it('同时运行的子 Agent 超出上限时直接报错，不排队', async () => {
  state
    .db!.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('subagent-limit', '1')")
    .run();
  const parent = newSession(null, 'chat').sessionId!;
  const { requests, stop } = recorded();
  server.enqueue(
    taskCalls({ description: '甲', prompt: '做甲' }, { description: '乙', prompt: '做乙' }),
  );
  server.enqueue(reply('甲做完了', 200));
  server.enqueue(reply('一个做完，一个超限'));
  await askSession(parent, input('并行派两个'));
  stop();
  state.db!.prepare("DELETE FROM workspace_settings WHERE key='subagent-limit'").run();

  expect(requests).toHaveLength(3);
  expect(children(parent)).toHaveLength(1);
  const results = taskResults(parent);
  expect(results.map((result) => Boolean(result.output?.isError))).toEqual([false, true]);
  expect(results[1]!.output?.text).toContain('上限（1 个）');
});

it('后台子 Agent 立即返回并占用并发名额，结束时把最终回复作为通知交回父会话', async () => {
  state
    .db!.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('subagent-limit', '1')")
    .run();
  const parent = newSession(null, 'chat').sessionId!;
  const parentRequests: RecordedRequest[] = [];
  const stop = server.onRequest((request) => {
    if (!JSON.stringify(request.body).includes('派个后台的')) {
      server.enqueue(reply('整理完了：三点', 800));
      return;
    }
    parentRequests.push(request);
    server.enqueue(
      [
        taskCalls({ description: '后台整理', prompt: '慢慢整理', background: true }),
        taskCalls({ description: '再派', prompt: '超出名额' }),
        reply('已派出'),
        reply('子 Agent 交回了'),
      ][parentRequests.length - 1]!,
    );
  });
  await askSession(parent, input('派个后台的'));
  expect(parentRequests).toHaveLength(3);
  expect(taskResults(parent)[0]!.output?.details).toMatchObject({
    status: 'running',
    background: true,
  } satisfies Partial<SubagentDetails>);
  expect(JSON.stringify(parentRequests[2]!.body)).toContain('上限（1 个）');
  await vi.waitFor(() => expect(parentRequests).toHaveLength(4), { timeout: 10_000 });
  await vi.waitFor(() => expect(openSession(parent).running).toBe(false), { timeout: 10_000 });
  stop();
  state.db!.prepare("DELETE FROM workspace_settings WHERE key='subagent-limit'").run();

  expect(JSON.stringify(parentRequests[3]!.body)).toContain('整理完了：三点');
  const [child] = children(parent);
  expect(openSession(parent).messages.filter((message) => message.task)).toMatchObject([
    { task: { taskId: child, kind: 'subagent', status: 'completed', label: '后台整理' } },
  ]);
  expect(openSession(parent).messages.at(-1)).toMatchObject({ content: '子 Agent 交回了' });
});

it('归档父会话时子会话一并归档，删除时一并删除', async () => {
  const parent = newSession(null, 'chat').sessionId!;
  server.enqueue(taskCalls({ description: '随手', prompt: '做一下' }));
  server.enqueue(reply('好了'));
  server.enqueue(reply('完成'));
  await askSession(parent, input('派一个'));
  const [child] = children(parent);
  const archived = () =>
    (
      state.db!.prepare('SELECT archived FROM sessions WHERE id=?').get(child) as {
        archived: number;
      }
    ).archived;

  updateSessionVisibility(parent, { archived: true });
  expect(archived()).toBe(1);
  updateSessionVisibility(parent, { archived: false });
  expect(archived()).toBe(0);
  await deleteSession(parent);
  expect(state.db!.prepare('SELECT id FROM sessions WHERE id=?').get(child)).toBeUndefined();
});
