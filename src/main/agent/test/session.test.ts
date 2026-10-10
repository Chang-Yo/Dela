// 会话层：Pi 消息 → WorkspaceChat 投影；会话 cwd 恒为项目目录，项目目录缺失时报错而不换目录。
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const state = vi.hoisted(() => ({ db: null as Database.Database | null, root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: {} }));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../providers', () => ({ getActiveLlmProvider: () => null }));
vi.mock('../environment', () => ({
  agentEnvironment: () => ({ workspaceRoot: () => join(state.root, 'workspace') }),
}));
vi.mock('../../settings/task-notify', () => ({ notifyRunFinished: () => {} }));
import { newSession, openSession, projectMessages } from '../session';

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-session-'));
  state.db = new Database(':memory:');
  state.db.pragma('foreign_keys = ON');
  state.db.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
      kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT,
      updated_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL, file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
});

afterEach(() => {
  state.db?.close();
  rmSync(state.root, { recursive: true, force: true });
});

const assistant = (content: unknown[], extra: object = {}) =>
  ({
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'dela',
    model: 'm',
    usage: {},
    stopReason: 'toolUse',
    timestamp: 20,
    ...extra,
  }) as unknown as AgentMessage;

describe('projectMessages', () => {
  it('一轮内的思考、工具与正文合成一条回复，工具结果按 id 回填', () => {
    const messages = [
      { role: 'user', content: '改一下 a.txt', timestamp: 10 },
      assistant([
        { type: 'thinking', thinking: '先读文件' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a.txt' } },
      ]),
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'read',
        content: [{ type: 'text', text: 'alpha' }],
        isError: false,
        timestamp: 30,
      },
      assistant([{ type: 'text', text: '改好了' }], { stopReason: 'stop', timestamp: 40 }),
    ] as AgentMessage[];
    const [user, reply] = projectMessages(messages);
    expect(user).toMatchObject({ role: 'user', content: '改一下 a.txt' });
    expect(reply).toMatchObject({ role: 'assistant', content: '改好了', startedAt: 10 });
    expect(reply!.parts!.map((part) => part.type)).toEqual(['reasoning', 'tools', 'text']);
    expect(reply!.toolResults![0]).toMatchObject({
      name: 'read',
      input: { path: 'a.txt' },
      output: { text: 'alpha' },
      finishedAt: 30,
    });
  });

  it('用户消息的 Dela 元数据前缀不进展示，引用与图片还原到消息字段', () => {
    const meta = { body: '看看这个', sources: [{ key: 'D:/p/a.md', title: 'D:/p/a.md' }] };
    const [user] = projectMessages([
      {
        role: 'user',
        content: `<dela-meta>${JSON.stringify(meta)}</dela-meta>\n用户引用了这些文件……看看这个`,
        timestamp: 1,
      },
    ] as AgentMessage[]);
    expect(user).toMatchObject({ content: '看看这个', sources: meta.sources });
  });

  it('模型报错的回复标记中断并给出原因', () => {
    const [, reply] = projectMessages([
      { role: 'user', content: 'hi', timestamp: 1 },
      assistant([], { stopReason: 'error', errorMessage: '401: unauthorized' }),
    ] as AgentMessage[]);
    expect(reply).toMatchObject({ interrupted: true });
    expect(reply!.content).toContain('401');
  });

  it('运行中：末条为用户消息时补占位回复，回复不带 finishedAt', () => {
    const projected = projectMessages(
      [{ role: 'user', content: 'hi', timestamp: 5 }] as AgentMessage[],
      undefined,
      true,
    );
    expect(projected.at(-1)).toMatchObject({ role: 'assistant', startedAt: 5 });
    expect(projected.at(-1)!.finishedAt).toBeUndefined();
  });
});

describe('会话归属与 cwd', () => {
  it('项目会话的 cwd 是项目目录；空会话入口每个项目只有一个', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p1', NULL, '课题', 'project', NULL, ?, NULL, 'x')",
      )
      .run(state.root);
    const first = newSession('p1');
    expect(first).toMatchObject({ projectId: 'p1', cwd: state.root });
    expect(newSession('p1').sessionId).toBe(first.sessionId);
    expect(openSession(first.sessionId!).projectId).toBe('p1');
  });

  it('项目目录不存在时拒绝新建会话，不回退到其他目录', () => {
    state
      .db!.prepare(
        "INSERT INTO workspace_entries VALUES ('p2', NULL, '丢失', 'project', NULL, ?, NULL, 'x')",
      )
      .run(join(state.root, 'missing'));
    expect(() => newSession('p2')).toThrow('项目目录不存在');
  });

  it('非项目条目不能作为会话归属', () => {
    expect(() => newSession('nope')).toThrow('项目不存在');
  });
});
