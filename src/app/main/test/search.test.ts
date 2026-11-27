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

import { closeDatabase, getDatabase, openDatabase } from '../database';
import type { SearchGroup } from '../../../modules/search/contract';
import { registerSearchProvider, searchModule } from '../../../modules/search';
import { remotesModule } from '../../../modules/remotes';
import { workspaceModule } from '../../../modules/workspace';
import { mailModule, mailSearch } from '../../../modules/mail';
import { provideTestHostPorts } from '../../../core/test/host-mock';

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
  provideTestHostPorts({ database: getDatabase });
  openDatabase([remotesModule, workspaceModule, mailModule]);
  workspaceModule.register?.();
  registerSearchProvider(mailSearch);
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
  for (const table of ['sessions', 'mail_messages']) run(`DELETE FROM ${table}`);
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

  it('已删除的邮件不出现', () => {
    insertMail(3, '已删除的 lecture-notes.pdf', timestamp);
    insertMail(4, '保留的 lecture-notes.pdf');
    expect(hitsOf('lecture-notes.pdf', 'mail').map((hit) => hit.title)).toEqual([
      '保留的 lecture-notes.pdf',
    ]);
  });
});
