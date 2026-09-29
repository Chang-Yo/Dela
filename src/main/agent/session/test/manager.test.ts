// Session/Run 身份的主进程行为：run 生命周期落库（pending→running→终态）、步骤索引、
// 同 session 串行/跨 session 并行、newSession 的项目归属与项目档案，
// 以及上下文预算压缩（触发/失败回退/摘要持久化续接/compacting 状态）。
// 数据库用真实 database.ts（electron app.getPath 指向临时目录，迁移直建 v13）；
// 摘要生成的模型调用用 fetch stub（不走真网）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtures = vi.hoisted(() => ({ run: vi.fn() }));
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
vi.mock('../../../canvas/api', () => ({ readCanvasSource: vi.fn() }));
vi.mock('../../../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));
vi.mock('../../../workspace/api', () => ({ readWorkspaceEntry: vi.fn() }));
vi.mock('../../core/providers', () => ({
  getActiveLlmProvider: () => ({
    name: 'fixture',
    baseUrl: 'https://example.test',
    model: 'fixture',
    models: [],
    apiKey: 'fixture',
  }),
}));
vi.mock('../../tools/registry', () => ({
  modelToolDefinitions: () => [],
  executeAgentTool: vi.fn(),
}));
vi.mock('../../core/run', () => ({ runAgent: fixtures.run }));
vi.mock('../media', () => ({
  readChatAttachment: vi.fn((id: string) => ({
    name: `附件-${id.slice(0, 4)}.md`,
    bytes: Buffer.from('# 附件内容'),
  })),
  readChatMediaBytes: vi.fn(() => Buffer.from('pngbytes')),
  releaseChatAttachments: vi.fn(),
}));
import { closeDatabase, getDatabase } from '../../../database';
import {
  askSession,
  cancelRun,
  deleteSession,
  listSessions,
  newSession,
  openSession,
} from '../manager';
import { activeRuns, interruptStaleRuns } from '../runs';
import { sessionRow } from '../store';
import { getProjectProfile, updateProjectProfile } from '../../../workspace/projects';
import type { runAgent } from '../../core/run';
type Callbacks = Parameters<typeof runAgent>[0];
const result = { id: 'tool', name: 'search_sources', input: {}, output: { ok: true } };

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';

function runRowOf(sessionId: string) {
  return getDatabase().prepare('SELECT * FROM runs WHERE session_id=?').get(sessionId) as {
    id: string;
    status: string;
    request: string;
    steps: string;
    error: string | null;
    started_at: string;
    ended_at: string | null;
  };
}

function seedEntries() {
  const db = getDatabase();
  const insert = db.prepare(
    'INSERT INTO workspace_entries (id, parent_id, name, kind, updated_at) VALUES (?, NULL, ?, ?, ?)',
  );
  insert.run(PROJECT_ID, '毕业设计', 'project', '2026-09-01T00:00:00.000Z');
  insert.run(FOLDER_ID, '归档', 'folder', '2026-09-02T00:00:00.000Z');
}

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-session-'));
  getDatabase();
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

beforeEach(() => {
  getDatabase().exec(
    'DELETE FROM runs; DELETE FROM sessions; DELETE FROM projects; DELETE FROM workspace_entries',
  );
  seedEntries();
  activeRuns.clear();
  fixtures.run.mockReset();
  fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('run lifecycle', () => {
  it('persists pending→running→completed with request summary, step index and messages', async () => {
    const sessionId = newSession(null).sessionId!;
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      // 执行中：已转 running，请求摘要含文本前缀；快照呈现运行态。
      const mid = runRowOf(sessionId);
      expect(mid.status).toBe('running');
      expect(JSON.parse(mid.request)).toMatchObject({ text: '查找资料' });
      expect(openSession(sessionId).running).toBe(true);
      callbacks.onText?.('先查资料');
      callbacks.onToolStart?.({ id: 'tool', name: 'search_sources', input: { query: 'lab' } });
      callbacks.onToolResult?.(result);
      return { content: '找到资料，已完成', toolResults: [result] };
    });
    const chat = await askSession(sessionId, { text: '查找资料', attachments: [], context: [] });
    const run = runRowOf(sessionId);
    expect(run.status).toBe('completed');
    expect(run.ended_at).toBeTruthy();
    expect(run.error).toBeNull();
    // 步骤轻量索引：input/output 全文留在消息 JSON。
    expect(JSON.parse(run.steps)).toEqual([
      expect.objectContaining({ id: 'tool', name: 'search_sources', status: 'completed' }),
    ]);
    expect(chat.messages.at(-1)?.content).toBe('先查资料\n\n找到资料，已完成');
    expect(chat.running).toBe(false);
    // 首条消息为会话命名；消息与标题落库。
    const row = sessionRow(sessionId)!;
    expect(row.title).toBe('查找资料');
    expect(JSON.parse(row.messages).at(-1).content).toBe('先查资料\n\n找到资料，已完成');
    expect(openSession(sessionId).running).toBe(false);
  });

  it('marks failed tool results in the step index', async () => {
    const sessionId = newSession(null).sessionId!;
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onToolStart?.({ id: 'bad', name: 'search_mail', input: {} });
      callbacks.onToolResult?.({
        id: 'bad',
        name: 'search_mail',
        input: {},
        output: { ok: false, error: { code: 'NOT_CONFIGURED' } },
      });
      return { content: '未配置', toolResults: [] };
    });
    await askSession(sessionId, { text: '查邮件', attachments: [], context: [] });
    expect(JSON.parse(runRowOf(sessionId).steps)).toEqual([
      expect.objectContaining({ id: 'bad', status: 'failed', finishedAt: expect.any(Number) }),
    ]);
  });

  it('serializes runs per session but allows parallel runs across sessions', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    fixtures.run.mockImplementationOnce(async () => {
      await gate;
      return { content: '一', toolResults: [] };
    });
    const a = newSession(null).sessionId!;
    const b = newSession(null).sessionId!;
    const first = askSession(a, { text: '问题A', attachments: [], context: [] });
    // 同 session 第二个请求被拒（沿用现状错误语义）。
    await expect(askSession(a, { text: '问题B', attachments: [], context: [] })).rejects.toThrow(
      '请等待当前回答完成',
    );
    let secondStarted = false;
    fixtures.run.mockImplementationOnce(async () => {
      secondStarted = true;
      return { content: '二', toolResults: [] };
    });
    const second = askSession(b, { text: '问题B', attachments: [], context: [] });
    // 跨 session 并行（裁决 9）。
    await vi.waitFor(() => expect(secondStarted).toBe(true));
    releaseFirst();
    await Promise.all([first, second]);
    expect(runRowOf(a).status).toBe('completed');
    expect(runRowOf(b).status).toBe('completed');
  });

  it('records a failed run with the error when the model request errors', async () => {
    const sessionId = newSession(null).sessionId!;
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onText?.('部分回答');
      throw new Error('取消');
    });
    await expect(
      askSession(sessionId, { text: '问题', attachments: [], context: [] }),
    ).rejects.toThrow('取消');
    const run = runRowOf(sessionId);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('取消');
    expect(run.ended_at).toBeTruthy();
    const reply = JSON.parse(sessionRow(sessionId)!.messages).at(-1);
    expect(reply.interrupted).toBe(true);
    expect(reply.content).toContain('部分回答');
    expect(openSession(sessionId).running).toBe(false);
  });

  it('records a stopped run when the user cancels mid-flight', async () => {
    const sessionId = newSession(null).sessionId!;
    fixtures.run.mockImplementation(async (options: Callbacks) => {
      cancelRun(sessionId);
      // 模拟 runAgent 被用户中止后抛出的 AbortError。
      if (options.signal.aborted)
        throw new DOMException('This operation was aborted', 'AbortError');
      return { content: '完成', toolResults: [] };
    });
    const chat = await askSession(sessionId, { text: '问题', attachments: [], context: [] });
    expect(chat.messages.at(-1)?.stopped).toBe(true);
    expect(runRowOf(sessionId).status).toBe('stopped');
    expect(runRowOf(sessionId).error).toBeNull();
  });

  it('records a failed run for pre-send validation failures without touching messages', async () => {
    const sessionId = newSession(null).sessionId!;
    await expect(
      askSession(sessionId, { text: '   ', attachments: [], context: [] }),
    ).rejects.toThrow('请输入内容或添加图片');
    const run = runRowOf(sessionId);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('请输入内容或添加图片');
    expect(sessionRow(sessionId)!.messages).toBe('[]');
  });

  it('rejects asks for missing sessions', async () => {
    await expect(
      askSession('00000000-0000-4000-8000-000000000000', {
        text: '问题',
        attachments: [],
        context: [],
      }),
    ).rejects.toThrow('会话不存在');
  });

  it('interrupts stale pending/running runs at startup', () => {
    const db = getDatabase();
    const iso = '2026-09-29T00:00:00.000Z';
    db.prepare(
      'INSERT INTO sessions (id, project_id, title, messages, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)',
    ).run('s-x', '旧会话', '[]', iso, iso);
    const insert = db.prepare(
      'INSERT INTO runs (id, session_id, status, started_at) VALUES (?, ?, ?, ?)',
    );
    insert.run('r-open', 's-x', 'running', iso);
    insert.run('r-pending', 's-x', 'pending', iso);
    insert.run('r-done', 's-x', 'completed', iso);
    interruptStaleRuns();
    const byId = new Map(
      (
        db.prepare('SELECT id, status, error FROM runs').all() as {
          id: string;
          status: string;
          error: string | null;
        }[]
      ).map((row) => [row.id, row]),
    );
    expect(byId.get('r-open')).toMatchObject({ status: 'interrupted', error: '应用退出时中断' });
    expect(byId.get('r-pending')?.status).toBe('interrupted');
    expect(byId.get('r-done')?.status).toBe('completed');
  });

  it('deletes a session together with its runs', async () => {
    const sessionId = newSession(null).sessionId!;
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    await askSession(sessionId, { text: '问题', attachments: [], context: [] });
    expect(runRowOf(sessionId)).toBeDefined();
    deleteSession(sessionId);
    expect(sessionRow(sessionId)).toBeNull();
    expect(runRowOf(sessionId)).toBeUndefined();
  });
});

describe('multimodal ask input', () => {
  it('sends ordered text/image parts, inlines attachments and persists stripped content', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const imageId = '01234567-89ab-cdef-0123-456789abcdef';
    const attachmentId = '22222222-2222-2222-2222-222222222222';
    const text = `看这张图\n![截图.png](dela-img:${imageId})\n再补充说明`;
    const sessionId = newSession(null).sessionId!;
    const chat = await askSession(sessionId, { text, attachments: [attachmentId], context: [] });
    const last = fixtures.run.mock.calls.at(-1)![0]!.messages.at(-1);
    const parts = last.content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    // 前言（资料/附件/用户请求）在首个 text part，其后按输入顺序排列文字与图片。
    expect(parts.map((part) => part.type)).toEqual(['text', 'text', 'image_url', 'text']);
    expect(parts[0]!.text).toContain('本次选中的资料');
    expect(parts[0]!.text).toContain('附件内容');
    expect(parts[0]!.text!.endsWith('用户请求：')).toBe(true);
    expect(parts[2]!.image_url!.url).toMatch(/^data:image\/png;base64,/);
    const user = chat.messages[0]!;
    expect(user.role).toBe('user');
    expect(user.content).toBe('看这张图\n\n再补充说明');
    expect(user.images).toEqual([{ id: imageId, name: '截图.png' }]);
    expect(user.attachments).toEqual([{ name: `附件-${attachmentId.slice(0, 4)}.md` }]);
  });

  it('keeps reasoning separate from the public content', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onReasoning?.('先分析请求，再规划工具');
      callbacks.onText?.('回答正文');
      return { content: '回答正文', toolResults: [] };
    });
    const sessionId = newSession(null).sessionId!;
    const chat = await askSession(sessionId, { text: '问题', attachments: [], context: [] });
    const reply = chat.messages.at(-1)!;
    expect(reply.parts?.[0]).toMatchObject({
      type: 'reasoning',
      text: '先分析请求，再规划工具',
      finishedAt: expect.any(Number),
    });
    expect(reply.parts?.[1]).toEqual({ type: 'text', text: '回答正文' });
    expect(reply.content).toBe('回答正文');
  });
});

describe('newSession ownership', () => {
  it('attaches sessions to existing projects and ensures the archive row', async () => {
    const chat = newSession(PROJECT_ID);
    expect(sessionRow(chat.sessionId!)!.project_id).toBe(PROJECT_ID);
    // v13 后新建的项目条目在首次挂会话时补建档案行。
    expect(
      getDatabase().prepare('SELECT id FROM projects WHERE id=?').get(PROJECT_ID),
    ).toBeDefined();
    // 通用池列表可见，项目列表不可见。
    expect(listSessions(PROJECT_ID, '')).toHaveLength(1);
    expect(listSessions(null, '')).toEqual([]);
  });

  it('rejects creation for ids that are not existing project entries', () => {
    expect(() => newSession(FOLDER_ID)).toThrow('项目不存在');
    expect(() => newSession('garbage-scope')).toThrow('项目不存在');
  });
});

describe('project profiles', () => {
  it('lazily creates and updates archive profiles for project entries only', () => {
    // beforeEach 重建的 project 条目没有档案行（v13 后新建项目的情形）。
    expect(getProjectProfile(PROJECT_ID)).toMatchObject({
      background: '',
      goal: '',
      workdir: null,
      capabilities: {},
    });
    expect(
      updateProjectProfile(PROJECT_ID, { background: '毕业设计项目', workdir: 'E:\\lab' }),
    ).toMatchObject({ background: '毕业设计项目', workdir: 'E:\\lab', goal: '' });
    expect(getProjectProfile(PROJECT_ID)).toMatchObject({ background: '毕业设计项目' });
    // workdir 传 null 清空、不传保留。
    expect(updateProjectProfile(PROJECT_ID, { workdir: null })).toMatchObject({
      background: '毕业设计项目',
      workdir: null,
    });
    expect(getProjectProfile(FOLDER_ID)).toBeNull();
    expect(getProjectProfile('nonexistent')).toBeNull();
  });
});

// ===== 上下文预算压缩（计划 §6.1；摘要模型调用 fetch stub，不走真网） =====

const compactPayload = {
  goals: '整理毕业设计资料',
  decisions: '先课件后邮件',
  completed: '已检索 Canvas 课件',
  pending: '待整理成笔记',
  resources: [{ key: 'note-1', title: '复习笔记' }],
};

/** 预置长历史会话（每条约 chars 个 CJK 字 ≈ chars token）。 */
function seedHistory(count: number, chars: number): string {
  const messages = Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `历史${index}。`.padEnd(chars, '备'),
  }));
  const iso = '2026-09-29T00:00:00.000Z';
  const id = randomUUID();
  getDatabase()
    .prepare(
      'INSERT INTO sessions (id, project_id, title, messages, summary, created_at, updated_at) VALUES (?, NULL, ?, ?, NULL, ?, ?)',
    )
    .run(id, '长对话', JSON.stringify(messages), iso, iso);
  return id;
}

const summaryResponse = () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(compactPayload) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

function askOptions() {
  return { text: '继续', attachments: [], context: [] };
}

describe('context compaction', () => {
  it('长对话超阈值触发压缩：摘要生成、持久化并以摘要+近期历史组装', async () => {
    // 20 条 × 1000 token ≈ 20000：超过触发阈值 14336。
    const sessionId = seedHistory(20, 1000);
    const fetchMock = vi.fn().mockResolvedValue(summaryResponse());
    vi.stubGlobal('fetch', fetchMock);
    await askSession(sessionId, askOptions());
    // 独立非流式请求打到 provider 的 /chat/completions，带鉴权。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://example.test/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fixture');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('fixture');
    expect(body.messages[1].content).toContain('【待压缩的对话历史（第 1–8 条消息）】');
    // 摘要持久化到 sessions.summary（跨 Run 生效）。
    const stored = JSON.parse(sessionRow(sessionId)!.summary!) as {
      coveredUpTo: number;
      messageCount: number;
    };
    expect(stored).toMatchObject({ coveredUpTo: 8, messageCount: 20 });
    // 组装：system 含摘要前置块（标注非资源最新状态），历史从覆盖锚点之后注入。
    const messages = fixtures.run.mock.calls.at(-1)![0]!.messages;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('本会话较早历史摘要');
    expect(messages[0]!.content).toContain('不是任何资源的最新状态');
    expect(messages[0]!.content).toContain('整理毕业设计资料');
    expect(messages.length).toBe(1 + 12 + 1);
    expect(messages[1]!.content).toContain('历史8。');
    expect(messages.at(-2)!.content).toContain('历史19。');
    expect(runRowOf(sessionId).status).toBe('completed');
  });

  it('压缩失败且放不下时请求明确失败：保留原始历史，不静默回退条数截断', async () => {
    // 30 条 × 1000 token ≈ 30000：超出输入预算 20480，压缩是唯一出路。
    const sessionId = seedHistory(30, 1000);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('网络中断')));
    await expect(askSession(sessionId, askOptions())).rejects.toThrow(
      '上下文压缩失败，请重试或减少引用资料',
    );
    expect(fetchMockRan()).toBe(true);
    // 未调用模型执行、历史与摘要保持原样、run 落 failed。
    expect(fixtures.run).not.toHaveBeenCalled();
    expect(JSON.parse(sessionRow(sessionId)!.messages)).toHaveLength(30);
    expect(sessionRow(sessionId)!.summary).toBeNull();
    const run = runRowOf(sessionId);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('上下文压缩失败');
    expect(openSession(sessionId).running).toBe(false);
  });

  it('压缩失败但不压缩也放得下时照常发送全量历史', async () => {
    // 10 条 × 1500 token ≈ 15000：超过阈值 14336 但在预算 20480 内。
    const sessionId = seedHistory(10, 1500);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('网络中断')));
    const chat = await askSession(sessionId, askOptions());
    expect(chat.running).toBe(false);
    // 全量历史照常发送（无摘要块），摘要不落库。
    const messages = fixtures.run.mock.calls.at(-1)![0]!.messages;
    expect(messages).toHaveLength(1 + 10 + 1);
    expect(messages[0]!.content).not.toContain('本会话较早历史摘要');
    expect(messages[1]!.content).toContain('历史0。');
    expect(messages.at(-2)!.content).toContain('历史9。');
    expect(sessionRow(sessionId)!.summary).toBeNull();
    expect(runRowOf(sessionId).status).toBe('completed');
  });

  it('重启续接：持久化的摘要在新 Run 组装时生效（不再触发压缩）', async () => {
    // 模拟此前压缩过的会话：18 条已被摘要覆盖，仅 2 条近期历史。
    const sessionId = seedHistory(20, 100);
    getDatabase()
      .prepare('UPDATE sessions SET summary=? WHERE id=?')
      .run(
        JSON.stringify({
          coveredUpTo: 18,
          createdAt: '2026-09-29T00:00:00.000Z',
          model: 'fixture',
          content: compactPayload,
          messageCount: 18,
        }),
        sessionId,
      );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await askSession(sessionId, askOptions());
    // 估算低于阈值：不再请求摘要模型。
    expect(fetchMock).not.toHaveBeenCalled();
    const messages = fixtures.run.mock.calls.at(-1)![0]!.messages;
    expect(messages[0]!.content).toContain('本会话较早历史摘要');
    expect(messages[0]!.content).toContain('第 1–18 条消息');
    // 只注入覆盖锚点之后的近期历史。
    expect(messages).toHaveLength(1 + 2 + 1);
    expect(messages[1]!.content).toContain('历史18。');
  });

  it('compacting 状态在压缩期间为 true，结束后回落', async () => {
    const sessionId = seedHistory(20, 1000);
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate),
    );
    const asking = askSession(sessionId, askOptions());
    await vi.waitFor(() => expect(openSession(sessionId).compacting).toBe(true));
    release(summaryResponse());
    await asking;
    expect(openSession(sessionId).compacting).toBe(false);
    expect(sessionRow(sessionId)!.summary).not.toBeNull();
  });
});

/** 断言辅助：stub 的 fetch 是否被调用过（失败用例中确认压缩确实发起过）。 */
function fetchMockRan(): boolean {
  const mocked = globalThis.fetch as unknown as { mock?: { calls: unknown[] } };
  return Boolean(mocked?.mock?.calls?.length);
}
