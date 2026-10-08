import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../todo', () => ({ getTodoState: vi.fn(() => ({ items: [] })) }));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../database', () => ({ getDatabase: () => database }));
vi.mock('../ipc', () => ({ checkWorkspaceSender: vi.fn() }));

import { queryGlobalSearch } from '../search';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, name TEXT, kind TEXT, updated_at TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, messages TEXT, updated_at TEXT);
    CREATE TABLE mail_messages (
      id INTEGER PRIMARY KEY, subject TEXT, sender_name TEXT, sender_address TEXT, snippet TEXT,
      body_text TEXT, date TEXT, deleted_at TEXT
    );
    CREATE TABLE canvas_courses (id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER, data TEXT);
  `);
});

describe('global search', () => {
  it('matches literal LIKE characters instead of treating them as wildcards', () => {
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      1,
      '100%_! exact',
      '老师',
      'teacher@example.test',
      null,
      null,
      '2026-09-16T12:00:00.000Z',
      null,
    );
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      2,
      '100xx exact',
      '老师',
      'teacher@example.test',
      null,
      null,
      '2026-09-16T11:00:00.000Z',
      null,
    );

    expect(queryGlobalSearch('100%_! exact').filter((item) => item.kind === 'mail')).toEqual([
      expect.objectContaining({ id: 1 }),
    ]);
  });

  it('searches chat message content but excludes tool payload JSON and names project scopes', () => {
    insert(
      'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
      'project-1',
      '毕业设计',
      'project',
      '2026-09-16T12:00:00.000Z',
    );
    insert(
      'INSERT INTO sessions VALUES (?, ?, ?, ?, ?)',
      'chat-content',
      'project-1',
      '资料讨论',
      JSON.stringify([
        { role: 'user', content: '寻找散热方案', toolResults: [{ output: '不要匹配' }] },
      ]),
      '2026-09-16T12:00:00.000Z',
    );
    insert(
      'INSERT INTO sessions VALUES (?, ?, ?, ?, ?)',
      'chat-tools',
      null,
      '工具结果',
      JSON.stringify([
        { role: 'assistant', content: '已完成', toolResults: [{ output: '仅工具载荷' }] },
      ]),
      '2026-09-16T11:00:00.000Z',
    );

    expect(queryGlobalSearch('散热方案')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'chat',
          id: 'chat-content',
          subtitle: '毕业设计',
          target: { page: 'chat', scope: 'project-1', sessionId: 'chat-content' },
        }),
      ]),
    );
    // 通用会话（project_id NULL，旧 home/sources/projects 入口并入）深链回退 'home'。
    expect(queryGlobalSearch('工具结果')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'chat',
          id: 'chat-tools',
          subtitle: '首页',
          target: { page: 'chat', scope: 'home', sessionId: 'chat-tools' },
        }),
      ]),
    );
    expect(queryGlobalSearch('仅工具载荷').filter((item) => item.kind === 'chat')).toHaveLength(0);
  });

  it('returns cached Canvas filenames only and ignores deleted mail', () => {
    insert('INSERT INTO canvas_courses VALUES (?, ?)', 1, JSON.stringify({ name: '信号与系统' }));
    insert(
      'INSERT INTO canvas_sources VALUES (?, ?, ?)',
      'file:1',
      1,
      JSON.stringify({ id: 'file:1', kind: 'file', title: 'lecture-notes.pdf' }),
    );
    insert(
      'INSERT INTO canvas_sources VALUES (?, ?, ?)',
      'assignment:1',
      1,
      JSON.stringify({ id: 'assignment:1', kind: 'assignment', title: 'lecture-notes.pdf' }),
    );
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      3,
      '已删除的 lecture-notes.pdf',
      null,
      null,
      null,
      null,
      '2026-09-16T12:00:00.000Z',
      '2026-09-16T12:01:00.000Z',
    );

    const results = queryGlobalSearch('lecture-notes.pdf');
    expect(results.filter((item) => item.kind === 'course-file')).toEqual([
      expect.objectContaining({ id: 'file:1', subtitle: '信号与系统' }),
    ]);
    expect(results.filter((item) => item.kind === 'mail')).toHaveLength(0);
  });

  it('caps each result category at ten records', () => {
    for (let index = 0; index < 11; index += 1)
      insert(
        'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
        `project-${index}`,
        '同名项目',
        'project',
        `2026-09-16T12:00:${String(index).padStart(2, '0')}.000Z`,
      );

    expect(queryGlobalSearch('同名项目').filter((item) => item.kind === 'project')).toHaveLength(
      10,
    );
  });
});
