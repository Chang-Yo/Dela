// Session/Run 新身份的主进程行为：run 生命周期落库（pending→running→终态）、步骤索引、
// 同 session 串行/跨 session 并行、旧 scope 通道委托（scope→project_id 映射）与项目档案。
// 数据库用真实 database.ts（electron app.getPath 指向临时目录，迁移直建 v13）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  ask,
  askSession,
  cancelAsk,
  cancelRun,
  deleteChat,
  deleteSession,
  listChats,
  listSessions,
  newChat,
  newSession,
  openChat,
  openSession,
  scopeToProjectId,
} from '../manager';
import { activeRuns, interruptStaleRuns } from '../runs';
import { activeSession, getChat, sessionRow } from '../store';
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
  activeSession.clear();
  activeRuns.clear();
  fixtures.run.mockReset();
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

describe('legacy scope shim (transitional)', () => {
  it('maps scopes to project ids per the migration rule', () => {
    expect(scopeToProjectId('home')).toBeNull();
    expect(scopeToProjectId('sources')).toBeNull();
    expect(scopeToProjectId('projects')).toBeNull();
    expect(scopeToProjectId(PROJECT_ID)).toBe(PROJECT_ID);
  });

  it('lazily creates a general session on first ask from a legacy scope', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const chat = await ask('home', { text: '查找资料', attachments: [], context: [] });
    expect(chat.sessionId).toBeTruthy();
    expect(sessionRow(chat.sessionId!)!.project_id).toBeNull();
    expect(getChat('home').sessionId).toBe(chat.sessionId);
    expect(sessionRow(chat.sessionId!)!.title).toBe('查找资料');
    // 通用池列表可见，项目列表不可见。
    expect(listChats('home', '')).toHaveLength(1);
    expect(listChats(PROJECT_ID, '')).toEqual([]);
    // 搜索按标题过滤。
    getDatabase()
      .prepare('UPDATE sessions SET title=? WHERE id=?')
      .run('资料讨论', chat.sessionId!);
    expect(listSessions(null, '资料讨论')).toHaveLength(1);
    expect(listSessions(null, '不存在的话题')).toEqual([]);
  });

  it('attaches sessions to the project for project scopes and ensures the archive row', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const chat = await ask(PROJECT_ID, { text: '推进项目', attachments: [], context: [] });
    expect(sessionRow(chat.sessionId!)!.project_id).toBe(PROJECT_ID);
    // v13 后新建的项目条目在首次挂会话时补建档案行。
    expect(
      getDatabase().prepare('SELECT id FROM projects WHERE id=?').get(PROJECT_ID),
    ).toBeDefined();
    expect(listChats(PROJECT_ID, '')).toHaveLength(1);
  });

  it('rejects asks for scopes that are not existing project entries', async () => {
    await expect(ask(FOLDER_ID, { text: '问题', attachments: [], context: [] })).rejects.toThrow(
      '项目不存在',
    );
    await expect(
      ask('garbage-scope', { text: '问题', attachments: [], context: [] }),
    ).rejects.toThrow('项目不存在');
  });

  it('keeps per-scope busy semantics on the pointer session and stops via cancelAsk', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixtures.run.mockImplementationOnce(async (options: Callbacks) => {
      await gate;
      if (options.signal.aborted)
        throw new DOMException('This operation was aborted', 'AbortError');
      return { content: 'x', toolResults: [] };
    });
    const first = ask('home', { text: '问题', attachments: [], context: [] });
    await expect(ask('home', { text: '再问', attachments: [], context: [] })).rejects.toThrow(
      '请等待当前回答完成',
    );
    // newChat/openChat 是同步函数：执行期抛错需用 toThrow 断言。
    expect(() => newChat('home')).toThrow('请等待当前回答完成');
    const other = newSession(null).sessionId!;
    expect(() => openChat('home', other)).toThrow('请等待当前回答完成');
    cancelAsk('home');
    release();
    const chat = await first;
    expect(chat.messages.at(-1)?.stopped).toBe(true);
    expect(runRowOf(chat.sessionId!).status).toBe('stopped');
  });

  it('clears empty pointer sessions on newChat and resets the scope to idle', async () => {
    // 无效输入的 ask 留下空会话与 failed run（旧入口懒创建的过渡差异）。
    await expect(ask('home', { text: '   ', attachments: [], context: [] })).rejects.toThrow(
      '请输入内容或添加图片',
    );
    expect(listChats('home', '')).toHaveLength(1);
    const chat = newChat('home');
    expect(chat.sessionId).toBeNull();
    expect(getChat('home').sessionId).toBeNull();
    expect(listChats('home', '')).toEqual([]);
  });

  it('guards openChat/deleteChat by project ownership', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const projectChat = await ask(PROJECT_ID, { text: '推进项目', attachments: [], context: [] });
    const generalChat = await ask('home', { text: '闲聊', attachments: [], context: [] });
    // 同步函数：项目会话不属于通用 scope，open/delete 静默/报错不越权。
    expect(() => openChat('home', projectChat.sessionId!)).toThrow('会话不存在');
    expect(() => deleteChat('home', projectChat.sessionId!)).not.toThrow();
    expect(sessionRow(projectChat.sessionId!)).not.toBeNull();
    // 通用池（home/sources/projects）互通；删除当前会话后指针回闲置。
    expect(openChat('sources', generalChat.sessionId!).sessionId).toBe(generalChat.sessionId);
    activeSession.set('home', generalChat.sessionId);
    deleteChat('home', generalChat.sessionId!);
    expect(sessionRow(generalChat.sessionId!)).toBeNull();
    expect(getChat('home').sessionId).toBeNull();
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
