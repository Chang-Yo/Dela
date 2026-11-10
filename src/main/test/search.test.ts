// 全局搜索对着 database.ts 建出来的真实表跑：影子 schema 曾经凭空补过列，让引用不存在的列也能全绿。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, isPackaged: false, getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../todo', () => ({ getTodoState: () => ({ items: [] }) }));

import { closeDatabase, getDatabase } from '../database';
import type { SearchGroup } from '../../modules/search/contract';
import { registerSearchProvider, searchModule } from '../../modules/search';
import { projectSearch } from '../workspace/search';
import { chatSearch } from '../agent/search';
import { mailSearch } from '../mail/search';
import { courseFileSearch } from '../canvas/search';

const timestamp = '2026-09-16T12:00:00.000Z';
const run = (sql: string, ...values: unknown[]) =>
  getDatabase()
    .prepare(sql)
    .run(...values);
const querySearch = (query: string) => searchModule.ipc?.call('query', query) as SearchGroup[];
const hitsOf = (query: string, group: string) =>
  querySearch(query).find((item) => item.id === group)?.hits ?? [];

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-search-'));
  for (const provider of [projectSearch, chatSearch, mailSearch, courseFileSearch])
    registerSearchProvider(provider);
  run(
    "INSERT INTO mail_accounts (address, imap_host, imap_port, created_at) VALUES ('a@sjtu.edu.cn', 'imap', 993, ?)",
    timestamp,
  );
  run("INSERT INTO mail_folders (account_id, path, name) VALUES (1, 'INBOX', '收件箱')");
});
afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const table of ['sessions', 'mail_messages', 'canvas_sources', 'canvas_courses'])
    run(`DELETE FROM ${table}`);
  run("DELETE FROM workspace_entries WHERE kind='project'");
});

const insertMail = (uid: number, subject: string, deletedAt: string | null = null) =>
  run(
    'INSERT INTO mail_messages (folder_id, uid, subject, date, deleted_at) VALUES (1, ?, ?, ?, ?)',
    uid,
    subject,
    timestamp,
    deletedAt,
  );

describe('global search', () => {
  it('把 LIKE 通配符当作字面量匹配', () => {
    insertMail(1, '100%_! exact');
    insertMail(2, '100xx exact');
    expect(hitsOf('100%_! exact', 'mail').map((hit) => hit.title)).toEqual(['100%_! exact']);
  });

  it('按标题搜到顶层会话并带上项目身份，子 Agent 会话不进搜索', () => {
    run(
      "INSERT INTO workspace_entries (id, name, kind, updated_at) VALUES ('p1', '毕业设计', 'project', ?)",
      timestamp,
    );
    const insertSession = (id: string, projectId: string | null, parentId: string | null) =>
      run(
        'INSERT INTO sessions (id, project_id, file, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        projectId,
        `${id}.jsonl`,
        `资料讨论 ${id}`,
        parentId,
        timestamp,
        timestamp,
      );
    insertSession('in-project', 'p1', null);
    insertSession('home', null, null);
    insertSession('child', 'p1', 'in-project');

    expect(hitsOf('资料讨论', 'chat')).toEqual([
      expect.objectContaining({
        id: 'in-project',
        subtitle: '毕业设计',
        target: { page: 'chat', projectId: 'p1', sessionId: 'in-project' },
      }),
      expect.objectContaining({ id: 'home', subtitle: '首页' }),
    ]);
    expect(hitsOf('', 'chat').map((hit) => hit.id)).not.toContain('child');
  });

  it('课程资料只匹配缓存的文件名，已删除的邮件不出现', () => {
    run(
      'INSERT INTO canvas_courses (id, data) VALUES (1, ?)',
      JSON.stringify({ name: '信号与系统' }),
    );
    for (const kind of ['file', 'assignment'])
      run(
        'INSERT INTO canvas_sources VALUES (?, 1, ?)',
        `${kind}:1`,
        JSON.stringify({ kind, title: 'lecture-notes.pdf' }),
      );
    insertMail(3, '已删除的 lecture-notes.pdf', timestamp);

    const groups = querySearch('lecture-notes.pdf');
    expect(groups.map((group) => group.id)).toEqual(['course-file']);
    expect(groups[0]?.hits).toEqual([
      expect.objectContaining({ id: 'file:1', subtitle: '信号与系统' }),
    ]);
  });

  it('每个来源最多十条，达到上限时标记截断', () => {
    for (let index = 0; index < 11; index += 1)
      run(
        "INSERT INTO workspace_entries (id, name, kind, updated_at) VALUES (?, '同名项目', 'project', ?)",
        `p-${index}`,
        timestamp,
      );
    const group = querySearch('同名项目').find((item) => item.id === 'project');
    expect(group?.hits).toHaveLength(10);
    expect(group?.truncated).toBe(true);
  });
});
