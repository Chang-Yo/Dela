// 对着 database.ts 建出来的真实表跑，避免影子 schema 掩盖不存在的列。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, isPackaged: false, getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn() },
}));

import { closeDatabase, getDatabase } from '../../../../app/main/database';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { courseFileSearch } from '../search';

provideTestHostPorts({ database: getDatabase });

const run = (sql: string, ...values: unknown[]) =>
  getDatabase()
    .prepare(sql)
    .run(...values);

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-canvas-search-'));
});
afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('课程资料搜索', () => {
  it('只匹配缓存的文件名，不匹配作业', () => {
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

    expect(courseFileSearch.search('lecture-notes.pdf', 10)).toEqual([
      expect.objectContaining({ id: 'file:1', subtitle: '信号与系统' }),
    ]);
  });
});
