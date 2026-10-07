// Session 层端到端集成：askSession 不 mock runAgent，经真实 core/run（Pi Agent Core 桥）
// 打到本地 mock OpenAI SSE 服务；工具走真实 tools/registry（executeAgentTool → read_file
// 读临时目录真实文件）。场景：a 流式对话、b 工具往返、c 中断、d 失败重试耗尽、
// e 历史续接。数据量保持很小，不触发上下文压缩（压缩分支属 context/ 领域，另有单测）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type { RunEvent, WorkspaceChat } from '../../../../shared/api';
import { MockOpenAiServer, mockFrames } from '../../core/test/mock-openai-server';

const state = vi.hoisted(() => ({ root: '', baseUrl: '' }));
// 最小 electron 桩：本文件加载真实 tools/registry 与业务模块，仅 app.getPath 在运行期被调用
//（数据库、凭据、chat-media 都落在临时 userData 下；其余 API 只在对应功能被触发时才访问）。
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
// 提供商配置指向 mock 服务：askSession 与快照均由此取 baseUrl/apiKey/model。
vi.mock('../../core/providers', () => ({
  getActiveLlmProvider: () => ({
    name: 'mock-openai',
    baseUrl: state.baseUrl,
    model: 'mock-model',
    models: ['mock-model'],
    apiKey: 'integration-key',
    effortLevels: [],
    presetId: null,
  }),
}));
import { closeDatabase, getDatabase } from '../../../database';
import { askSession, cancelRun, newSession } from '../manager';
import { activeRuns } from '../runs';
import { sessionRow } from '../store';
import { subscribeChat } from '../subscriptions';

type ChatRequestBody = {
  messages?: { role: string; content: unknown; tool_call_id?: string }[];
  tools?: { function: { name: string } }[];
};
type RunRow = {
  id: string;
  status: string;
  request: string;
  steps: string;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};
type ChatMessage = WorkspaceChat['messages'][number];
type ToolsPart = Extract<NonNullable<ChatMessage['parts']>[number], { type: 'tools' }>;

let server: MockOpenAiServer;

const textSse = (text: string) => ({
  kind: 'sse' as const,
  frames: [mockFrames.textDelta(text), mockFrames.finishFrame('stop')],
});
/** 一轮工具调用响应：name + arguments 分片，finish 为 tool_calls。 */
const toolCallSse = (id: string, name: string, args: string) => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.toolCallDelta({ index: 0, id, name }),
    mockFrames.toolCallDelta({ index: 0, arguments: args }),
    mockFrames.finishFrame('tool_calls'),
  ],
});

function runRowsOf(sessionId: string): RunRow[] {
  return getDatabase()
    .prepare('SELECT * FROM runs WHERE session_id=? ORDER BY started_at')
    .all(sessionId) as unknown as RunRow[];
}

// 订阅捕获：fake WebContents 进 subscriptions 的广播集合，记录 session:*/workspace:* 推送。
const send = vi.fn<(channel: string, ...args: unknown[]) => void>();
const client = { send, isDestroyed: () => false, once: vi.fn() } as unknown as WebContents;
const sessionUpdates = (sessionId: string): WorkspaceChat[] =>
  send.mock.calls
    .filter(([channel, id]) => channel === 'session:on-update' && id === sessionId)
    .map(([, , chat]) => chat as WorkspaceChat);
const runEventsOf = (sessionId: string): RunEvent[] =>
  send.mock.calls
    .filter(([channel]) => channel === 'session:on-run-event')
    .map(([, event]) => event as RunEvent)
    .filter((event) => event.sessionId === sessionId);
/** 流式内容是否已推送到订阅方（中断场景用它等待首个增量后再取消）。 */
const sawStreamContent = (sessionId: string, fragment: string) =>
  sessionUpdates(sessionId).some((chat) =>
    (chat.messages.at(-1)?.content ?? '').includes(fragment),
  );

beforeAll(async () => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-session-int-'));
  getDatabase();
  server = await MockOpenAiServer.start();
  state.baseUrl = server.baseUrl;
  subscribeChat(client);
});

afterAll(async () => {
  await server.close();
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(() => {
  getDatabase().exec(
    'DELETE FROM runs; DELETE FROM sessions; DELETE FROM projects; DELETE FROM workspace_entries',
  );
  activeRuns.clear();
  send.mockClear();
});

describe('session 集成：askSession → core/run（Pi）→ mock OpenAI', () => {
  it('a. 流式对话：消息 parts 落库、on-update 推送触发、run completed 且 steps 为空', async () => {
    const sessionId = newSession(null).sessionId!;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('想一下怎么回答'),
        mockFrames.textDelta('你好'),
        mockFrames.textDelta('，世界'),
        mockFrames.finishFrame('stop'),
      ],
    });
    const chat = await askSession(sessionId, { text: '打个招呼', attachments: [], context: [] });
    // 消息 JSON 持久化到 sessions 表：首条 user 消息命名会话，回答按 parts 分段。
    const row = sessionRow(sessionId)!;
    expect(row.title).toBe('打个招呼');
    const persisted = JSON.parse(row.messages) as ChatMessage[];
    expect(persisted[0]).toMatchObject({ role: 'user', content: '打个招呼' });
    expect(persisted[1]).toMatchObject({ role: 'assistant', content: '你好，世界' });
    expect(persisted[1]!.parts).toEqual([
      expect.objectContaining({ type: 'reasoning', text: '想一下怎么回答' }),
      { type: 'text', text: '你好，世界' },
    ]);
    expect(chat.messages.at(-1)?.content).toBe('你好，世界');
    expect(chat.running).toBe(false);
    // run 行 completed：请求摘要、空步骤索引与收尾时间。
    const run = runRowsOf(sessionId)[0]!;
    expect(run.status).toBe('completed');
    expect(run.ended_at).toBeTruthy();
    expect(run.error).toBeNull();
    expect(JSON.parse(run.steps)).toEqual([]);
    expect(JSON.parse(run.request)).toMatchObject({ text: '打个招呼' });
    // on-update 推送被触发：按 sessionId 广播，终态快照非运行中。
    const updates = sessionUpdates(sessionId);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toMatchObject({ running: false });
    // run 事件按状态机推进。
    expect(runEventsOf(sessionId).map((event) => event.status)).toEqual([
      'pending',
      'running',
      'completed',
    ]);
  });

  it('b. 工具往返：真实 read_file 经 Pi 工具桥执行，steps 与 toolResults 全链落库', async () => {
    const sessionId = newSession(null).sessionId!;
    const sample = join(state.root, 'sample.md');
    writeFileSync(sample, '集成样例\n');
    server.enqueue(toolCallSse('call-read', 'read_file', JSON.stringify({ path: sample })));
    server.enqueue(textSse('读到集成样例'));
    const chat = await askSession(sessionId, { text: '读一下文件', attachments: [], context: [] });
    const reply = chat.messages.at(-1)!;
    expect(reply.content).toBe('读到集成样例');
    // 消息 toolResults 完整：真实 registry → read_file 的输出形状。
    expect(reply.toolResults).toHaveLength(1);
    expect(reply.toolResults![0]).toMatchObject({
      id: 'call-read',
      name: 'read_file',
      input: { path: sample },
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });
    expect(reply.toolResults![0]!.output).toMatchObject({
      ok: true,
      result: { path: sample, text: '集成样例\n', totalLines: 2, nextOffset: null },
    });
    // parts 内工具组回填同一结果。
    const group = reply.parts?.find((part): part is ToolsPart => part.type === 'tools');
    expect(group?.results).toHaveLength(1);
    expect(group?.results[0]).toMatchObject({ id: 'call-read', name: 'read_file' });
    // runs.steps 轻量索引落库。
    const run = runRowsOf(sessionId)[0]!;
    expect(run.status).toBe('completed');
    expect(JSON.parse(run.steps)).toEqual([
      expect.objectContaining({ id: 'call-read', name: 'read_file', status: 'completed' }),
    ]);
    // 全链贯通：模型侧工具声明进入首轮请求；次轮回灌 role:'tool' 的执行结果。
    const requests = server.requests.slice(-2).map((request) => request.body as ChatRequestBody);
    expect(requests[0]!.tools?.map((tool) => tool.function.name)).toContain('read_file');
    const toolMessage = requests[1]!.messages!.find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({ role: 'tool', tool_call_id: 'call-read' });
    expect(String(toolMessage!.content)).toContain('"ok":true');
    // run 事件带活跃工具名。
    expect(runEventsOf(sessionId).some((event) => event.activeTool === 'read_file')).toBe(true);
  });

  it('c. 中断：慢流中途 cancelRun，run stopped 且已产出内容保留在消息', async () => {
    const sessionId = newSession(null).sessionId!;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('已生成的部分回答'),
        // 慢流：第二个增量前挂起，收到首个增量并推送后取消。
        { data: { choices: [{ index: 0, delta: { content: '迟到内容' } }] }, delayMs: 5000 },
        mockFrames.finishFrame('stop'),
      ],
    });
    const pending = askSession(sessionId, { text: '讲个长故事', attachments: [], context: [] });
    await vi.waitFor(() => expect(sawStreamContent(sessionId, '已生成的部分回答')).toBe(true));
    cancelRun(sessionId);
    const chat = await pending;
    expect(chat.messages.at(-1)?.stopped).toBe(true);
    expect(chat.messages.at(-1)?.content).toContain('已生成的部分回答');
    const run = runRowsOf(sessionId)[0]!;
    expect(run.status).toBe('stopped');
    expect(run.error).toBeNull();
    expect(
      runEventsOf(sessionId)
        .map((event) => event.status)
        .at(-1),
    ).toBe('stopped');
  });

  it(
    'd. 失败：mock 500 且默认退避重试耗尽，run failed、消息 interrupted',
    { timeout: 15000 },
    async () => {
      const sessionId = newSession(null).sessionId!;
      const before = server.requests.length;
      server.enqueue({ kind: 'status', status: 500 });
      server.enqueue({ kind: 'status', status: 500 });
      server.enqueue({ kind: 'status', status: 500 });
      await expect(
        askSession(sessionId, { text: '问点东西', attachments: [], context: [] }),
      ).rejects.toThrow('模型请求失败（HTTP 500）');
      // 默认退避 [1000, 3000]：首发 + 两次重试后耗尽。
      expect(server.requests.length - before).toBe(3);
      const run = runRowsOf(sessionId)[0]!;
      expect(run.status).toBe('failed');
      expect(run.error).toBe('模型请求失败（HTTP 500）');
      expect(run.ended_at).toBeTruthy();
      const reply = JSON.parse(sessionRow(sessionId)!.messages) as ChatMessage[];
      expect(reply.at(-1)?.interrupted).toBe(true);
      expect(reply.at(-1)?.content).toContain('HTTP 500');
      expect(
        runEventsOf(sessionId)
          .map((event) => event.status)
          .at(-1),
      ).toBe('failed');
    },
  );

  it('e. 历史续接：同一会话再次 askSession，第二问请求体携带此前问答', async () => {
    const sessionId = newSession(null).sessionId!;
    server.enqueue(textSse('第一答'));
    await askSession(sessionId, { text: '第一问', attachments: [], context: [] });
    const secondStart = server.requests.length;
    server.enqueue(textSse('第二答'));
    await askSession(sessionId, { text: '第二问', attachments: [], context: [] });
    // 重启续接语义：第二轮从持久化历史重建上下文（新进程不现实，等价于按 sessionId 重进）。
    const messages = (server.requests[secondStart]!.body as ChatRequestBody).messages!;
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[1]!.content).toBe('第一问');
    expect(messages[2]!.content).toBe('第一答');
    expect(JSON.stringify(messages[3]!.content)).toContain('第二问');
    expect(runRowsOf(sessionId).map((run) => run.status)).toEqual(['completed', 'completed']);
  });
});
