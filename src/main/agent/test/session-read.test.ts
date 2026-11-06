// 跨会话读取：用 Pi 的 SessionManager 构造会话记录，覆盖多次压缩、编辑重发分支、运行中 / 停止 / 中断的轮次、
// 插队并轮、超长回复与分页；session_search / session_read 只看当前项目内未归档的会话。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import type { SessionManager as Manager } from '@earendil-works/pi-coding-agent';

const root = mkdtempSync(join(tmpdir(), 'dela-session-read-'));
const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../providers', () => ({ llmProviders: () => [], usableLlmProviders: () => [] }));
vi.mock('../environment', () => ({ agentEnvironment: () => ({}) }));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
vi.mock('../extensions', () => ({}));
vi.mock('../packages', () => ({}));

import { loadPi } from '../pi';
import { preloadPi } from '../session';
import { pageTurns, sessionTools, sessionTurns, type SessionTurn } from '../session-read';

let SessionManager: typeof Manager;
let clock = 1_000;

const user = (text: string, turnId: string, meta: object = {}): Message => ({
  role: 'user',
  content: `<dela-meta>${JSON.stringify({ turnId, body: text, ...meta })}</dela-meta>\n${text}`,
  timestamp: (clock += 1000),
});
const assistant = (
  text: string,
  stopReason: 'stop' | 'toolUse' | 'aborted' | 'error' = 'stop',
  extra: object = {},
) =>
  ({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '内部推理' },
      ...(text ? [{ type: 'text', text }] : []),
      ...(stopReason === 'toolUse'
        ? [{ type: 'toolCall', id: `call-${clock}`, name: 'bash', arguments: { command: 'ls' } }]
        : []),
    ],
    api: 'openai-completions',
    provider: 'dela',
    model: 'm',
    usage: {},
    stopReason,
    timestamp: (clock += 1000),
    ...extra,
  }) as unknown as Message;
const toolResult = (toolCallId: string): Message =>
  ({
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content: [{ type: 'text', text: '工具输出不该出现' }],
    isError: false,
    timestamp: (clock += 1000),
  }) as Message;

/** 一轮：先说一句再调工具，工具结果回来后给出最终回复。 */
function toolTurn(manager: Manager, turnId: string, ask: string, answer: string) {
  manager.appendMessage(user(ask, turnId));
  const call = assistant('我先看看目录', 'toolUse');
  manager.appendMessage(call);
  const id = (call.content as { type: string; id?: string }[]).find(
    (block) => block.type === 'toolCall',
  )!.id!;
  manager.appendMessage(toolResult(id));
  return manager.appendMessage(assistant(answer));
}

beforeAll(async () => {
  await preloadPi();
  ({ SessionManager } = await loadPi());
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('sessionTurns', () => {
  it('读当前分支原文：跨越多次压缩，不含被编辑重发放弃的分支，只留用户消息与最终回复', () => {
    const manager = SessionManager.inMemory(root);
    const first = toolTurn(manager, 't1', '列出文件', '有 a.md 和 b.md');
    manager.appendCompaction('摘要一', first, 1000);
    toolTurn(manager, 't2', '读 a.md', 'a.md 讲的是复习计划');
    const beforeEdit = manager.appendCompaction('摘要二', null, 1000);
    manager.appendMessage(user('旧的提问', 't3'));
    manager.appendMessage(assistant('旧的回答'));
    manager.branch(beforeEdit);
    manager.appendMessage(user('改过的提问', 't3b'));
    manager.appendMessage(assistant('新的回答'));

    const turns = sessionTurns(manager.getBranch());
    expect(
      turns.map(({ turnId, user, reply, status }) => ({ turnId, user, reply, status })),
    ).toEqual([
      { turnId: 't1', user: '列出文件', reply: '有 a.md 和 b.md', status: 'completed' },
      { turnId: 't2', user: '读 a.md', reply: 'a.md 讲的是复习计划', status: 'completed' },
      { turnId: 't3b', user: '改过的提问', reply: '新的回答', status: 'completed' },
    ]);
    const text = JSON.stringify(turns);
    expect(text).not.toContain('工具输出不该出现');
    expect(text).not.toContain('内部推理');
    expect(text).not.toContain('我先看看目录');
    expect(text).not.toContain('旧的');
  });

  it('如实标出停止、中断与运行中的轮次，没有最终回复时不拿中间文字顶替', () => {
    const manager = SessionManager.inMemory(root);
    manager.appendMessage(user('停下的', 's'));
    manager.appendMessage(assistant('写了一半', 'aborted'));
    manager.appendMessage(user('出错的', 'e'));
    manager.appendMessage(assistant('', 'error', { errorMessage: 'HTTP 401' }));
    manager.appendMessage(user('退出时在调工具', 'x'));
    manager.appendMessage(assistant('先调个工具', 'toolUse'));
    manager.appendMessage(user('正在跑的', 'r'));
    manager.appendMessage(assistant('中间说明', 'toolUse'));

    expect(sessionTurns(manager.getBranch(), 'r')).toMatchObject([
      { turnId: 's', status: 'stopped', reply: null },
      { turnId: 'e', status: 'interrupted', reply: null, error: 'HTTP 401' },
      { turnId: 'x', status: 'interrupted', reply: null },
      { turnId: 'r', status: 'running', reply: null },
    ]);
  });

  it('插队消息与所在轮共用 turnId，并进同一轮；附件、@ 引用与 # 会话只列名称', () => {
    const manager = SessionManager.inMemory(root);
    manager.appendMessage(
      user('先做 A', 't', {
        attachments: [{ id: 'x', name: '作业.pdf' }],
        sources: [{ key: '/p/a.md', title: '/p/a.md' }],
      }),
    );
    manager.appendMessage(assistant('在做 A'));
    manager.appendMessage(
      user('顺便做 B', 't', {
        images: [{ id: 'i', name: '截图.png' }],
        sessions: [{ id: 's2', title: '期中整理' }],
      }),
    );
    manager.appendMessage(assistant('A 和 B 都做完了'));

    expect(sessionTurns(manager.getBranch())).toEqual([
      {
        turnId: 't',
        at: expect.any(String),
        user: '先做 A\n\n顺便做 B',
        files: ['作业.pdf', '截图.png'],
        references: ['/p/a.md'],
        sessions: ['期中整理'],
        reply: 'A 和 B 都做完了',
        status: 'completed',
      },
    ]);
  });
});

describe('pageTurns', () => {
  const turn = (turnId: string, reply: string): SessionTurn => ({
    turnId,
    at: '',
    user: `问 ${turnId}`,
    reply,
    status: 'completed',
  });
  const turns = ['a', 'b', 'c', 'd', 'e'].map((id) => turn(id, `${id}`.repeat(40)));

  it('默认取最近的若干轮，按时间正序；有更早的轮次时给出续读用的 before', () => {
    expect(pageTurns(turns, { turns: 2 })).toMatchObject({
      turns: [{ turnId: 'd' }, { turnId: 'e' }],
      before: 'd',
    });
    expect(pageTurns(turns, { turns: 2, before: 'd' })).toMatchObject({
      turns: [{ turnId: 'b' }, { turnId: 'c' }],
      before: 'b',
    });
    const last = pageTurns(turns, { turns: 10, before: 'b' });
    expect(last.turns.map(({ turnId }) => turnId)).toEqual(['a']);
    expect(last.before).toBeUndefined();
  });

  it('超出总长度时少取几轮，续读能接上；单轮超长时截断并标出', () => {
    // 每轮 43 字，上限 100 只容得下两轮。
    const page = pageTurns(turns, { turns: 10 }, 100);
    expect(page.turns.map(({ turnId }) => turnId)).toEqual(['d', 'e']);
    expect(page.before).toBe('d');
    const next = pageTurns(turns, { turns: 10, before: page.before }, 100);
    expect(next.turns.map(({ turnId }) => turnId)).toEqual(['b', 'c']);
    expect(next.before).toBe('b');

    const huge = turn('h', '长'.repeat(5000));
    const [clipped] = pageTurns([huge], { turns: 1 }, 1000).turns;
    expect(clipped!.truncated).toBe(true);
    expect(clipped!.user).toBe('问 h');
    expect(clipped!.reply!.length).toBeLessThan(1100);
    expect(clipped!.reply).toContain('已截断，原文 5000 字');
  });

  it('按 turnId 读单轮；不存在的轮次如实报错', () => {
    expect(pageTurns(turns, { turnId: 'c' }).turns).toEqual([turns[2]]);
    expect(() => pageTurns(turns, { turnId: 'zz' })).toThrow('没有这一轮');
    expect(() => pageTurns(turns, { before: 'zz' })).toThrow('没有这一轮');
  });
});

describe('session_search / session_read', () => {
  const tool = (projectId: string | null, name: string) =>
    sessionTools(projectId).find((item) => item.name === name)!;
  const call = async (projectId: string | null, name: string, params: object) =>
    JSON.parse(
      (
        (
          await tool(projectId, name).execute(
            'id',
            params as never,
            undefined,
            undefined,
            {} as never,
          )
        ).content[0] as { text: string }
      ).text,
    );

  beforeAll(() => {
    state.db = new Database(':memory:');
    state.db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT, file TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        provider_id TEXT, model TEXT, effort TEXT, parent_id TEXT);
    `);
    const manager = SessionManager.create(root, join(root, 'sessions'));
    manager.appendMessage(user('复习哪些章节', 't1'));
    manager.appendMessage(assistant('第三到第五章'));
    const insert = state.db.prepare(
      `INSERT INTO sessions (id, project_id, file, title, message_count, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    );
    insert.run('s1', 'p1', manager.getSessionFile(), '复习计划', 0, '2026-11-01', '2026-11-03');
    insert.run('s2', 'p1', '', '复习归档', 1, '2026-11-01', '2026-11-04');
    insert.run('s3', 'p2', '', '复习别的项目', 0, '2026-11-01', '2026-11-05');
    insert.run('s4', 'p1', '', '期中整理', 0, '2026-11-01', '2026-11-02');
  });

  it('只在当前项目内按标题查找，不含归档会话，不带正文', async () => {
    expect(await call('p1', 'session_search', { query: '复习' })).toEqual([
      { sessionId: 's1', title: '复习计划', updatedAt: '2026-11-03', running: false },
    ]);
    expect(
      (await call('p1', 'session_search', {})).map(
        ({ sessionId }: { sessionId: string }) => sessionId,
      ),
    ).toEqual(['s1', 's4']);
  });

  it('读本项目未归档的会话；归档、其他项目的会话与混用两种模式都拒绝', async () => {
    expect(await call('p1', 'session_read', { sessionId: 's1' })).toMatchObject({
      sessionId: 's1',
      title: '复习计划',
      turns: [{ turnId: 't1', user: '复习哪些章节', reply: '第三到第五章', status: 'completed' }],
    });
    await expect(call('p1', 'session_read', { sessionId: 's2' })).rejects.toThrow('已归档');
    await expect(call('p1', 'session_read', { sessionId: 's3' })).rejects.toThrow('已归档');
    await expect(
      call('p1', 'session_read', { sessionId: 's1', turnId: 't1', turns: 2 }),
    ).rejects.toThrow('不能与');
  });
});
