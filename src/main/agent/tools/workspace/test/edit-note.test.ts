// editWorkspaceNote 全部校验分支与 note_versions 记录策略（Agent 写入必记、首次记基线）。
// note_versions 表由 DB v13 迁移创建（列：note_id/revision/text/run_id 可空/created_at）；
// 本测试的内存库尚未接入该迁移，setup 手动建同构表。
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: { openPath: vi.fn() } }));
vi.mock('../../../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../../../canvas/api', () => ({ canvasFilePath: vi.fn(), readCanvasSource: vi.fn() }));
vi.mock('../../../../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));

import { getDatabase } from '../../../../database';
import {
  createWorkspaceEntry,
  editWorkspaceNote,
  readWorkspaceEntry,
  saveWorkspaceNote,
} from '../../../../workspace/api';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, note_id TEXT, local_path TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX workspace_parent ON workspace_entries(parent_id);
    CREATE TABLE note_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES workspace_notes(id) ON DELETE CASCADE,
      revision TEXT NOT NULL,
      text TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

/** 单测试单笔记，直接按插入顺序取全部版本行。 */
function noteVersions(): { revision: string; text: string; runId: string | null }[] {
  return getDatabase()
    .prepare('SELECT revision, text, run_id AS runId FROM note_versions ORDER BY id')
    .all() as { revision: string; text: string; runId: string | null }[];
}

const noteFile = (id: string) =>
  (
    getDatabase()
      .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
      .get(id) as { path: string }
  ).path;

let db: Database.Database;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-edit-note-'));
  db = createDb();
  vi.mocked(getDatabase).mockReturnValue(db);
});

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true });
});

describe('editWorkspaceNote', () => {
  it('一次提交多处修改：原子写入、返回定位摘要、记基线与新版本', async () => {
    const note = createWorkspaceEntry({
      parentId: null,
      name: '编辑笔记',
      kind: 'note',
      text: '# 标题\n\n第一段内容。\n\n第二段内容。\n',
    });
    const before = await readWorkspaceEntry(note.id);
    const result = editWorkspaceNote(
      note.id,
      [
        { oldText: '# 标题', newText: '# 新标题' },
        { oldText: '第二段内容。', newText: '第二段已修改。\n\n新增一行。' },
      ],
      before.revision!,
    );
    expect(readFileSync(noteFile(note.id), 'utf8')).toBe(
      '# 新标题\n\n第一段内容。\n\n第二段已修改。\n\n新增一行。\n',
    );
    expect(result.applied).toEqual([
      { index: 1, line: 1, start: 0, removed: 4, added: 5, preview: '# 新标题' },
      {
        index: 2,
        line: 5,
        start: 15,
        removed: 6,
        added: 14,
        preview: '第二段已修改。\n\n新增一行。',
      },
    ]);
    const versions = noteVersions();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      revision: before.revision!,
      text: '# 标题\n\n第一段内容。\n\n第二段内容。\n',
      runId: null,
    });
    expect(versions[1]).toMatchObject({ revision: result.revision });
    expect(versions[1]!.text).toBe(readFileSync(noteFile(note.id), 'utf8'));
  });

  it('第二次编辑不再重复记基线，只追加新版本', async () => {
    const note = createWorkspaceEntry({ parentId: null, name: '笔记', kind: 'note', text: 'v1' });
    const first = editWorkspaceNote(note.id, [{ oldText: 'v1', newText: 'v2' }], hashOf('v1'));
    const second = editWorkspaceNote(note.id, [{ oldText: 'v2', newText: 'v3' }], first.revision);
    const versions = noteVersions();
    expect(versions.map((v) => v.text)).toEqual(['v1', 'v2', 'v3']);
    expect(versions.at(-1)!.revision).toBe(second.revision);
  });

  it('oldText 不存在时全部失败：不落盘、不记版本、错误指明第几处', async () => {
    const note = createWorkspaceEntry({ parentId: null, name: '笔记', kind: 'note', text: '正文' });
    expect(() =>
      editWorkspaceNote(
        note.id,
        [
          { oldText: '正文', newText: '改' },
          { oldText: '不存在的原文', newText: 'x' },
        ],
        hashOf('正文'),
      ),
    ).toThrow('第 2 处修改：原文在笔记中不存在');
    expect(readFileSync(noteFile(note.id), 'utf8')).toBe('正文');
    expect(noteVersions()).toHaveLength(0);
  });

  it('oldText 出现多次时拒绝，提示扩大范围', () => {
    const note = createWorkspaceEntry({
      parentId: null,
      name: '笔记',
      kind: 'note',
      text: '重复 重复',
    });
    expect(() =>
      editWorkspaceNote(note.id, [{ oldText: '重复', newText: '一次' }], hashOf('重复 重复')),
    ).toThrow('第 1 处修改：原文出现多次，无法唯一定位');
  });

  it('多处修改区间重叠时拒绝', () => {
    const note = createWorkspaceEntry({
      parentId: null,
      name: '笔记',
      kind: 'note',
      text: 'abcdefghij',
    });
    expect(() =>
      editWorkspaceNote(
        note.id,
        [
          { oldText: 'cdefg', newText: 'X' },
          { oldText: 'abcdef', newText: 'Y' },
        ],
        hashOf('abcdefghij'),
      ),
    ).toThrow('第 2 处与第 1 处修改区间重叠');
    expect(readFileSync(noteFile(note.id), 'utf8')).toBe('abcdefghij');
  });

  it('base revision 不匹配报 VERSION_CONFLICT', () => {
    const note = createWorkspaceEntry({ parentId: null, name: '笔记', kind: 'note', text: '正文' });
    try {
      editWorkspaceNote(note.id, [{ oldText: '正文', newText: '改' }], 'stale');
      expect.unreachable('应当抛出版本冲突');
    } catch (error) {
      expect(error).toMatchObject({ code: 'VERSION_CONFLICT' });
    }
    expect(readFileSync(noteFile(note.id), 'utf8')).toBe('正文');
  });

  it('条目不存在报 NOT_FOUND；非笔记条目拒绝编辑', () => {
    try {
      editWorkspaceNote('0d9f5a34-6d3a-4a8f-8b0a-30c1f3a90f10', [], 'r');
      expect.unreachable('应当抛出 NOT_FOUND');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' });
    }
    const folder = createWorkspaceEntry({ parentId: null, name: '文件夹', kind: 'folder' });
    expect(() => editWorkspaceNote(folder.id, [], 'r')).toThrow('只有笔记可以编辑');
  });
});

describe('saveWorkspaceNote 版本记录', () => {
  it('缺省不记版本（用户编辑器保存路径行为不变）；recordVersion 时记基线与新版本', async () => {
    const note = createWorkspaceEntry({ parentId: null, name: '笔记', kind: 'note', text: 'v1' });
    const before = (await readWorkspaceEntry(note.id)).revision!;

    saveWorkspaceNote(note.id, 'v2', before);
    expect(noteVersions()).toHaveLength(0);

    const next = saveWorkspaceNote(note.id, 'v3', hashOf('v2'), { recordVersion: true });
    expect(noteVersions().map((v) => v.text)).toEqual(['v2', 'v3']);
    expect(noteVersions()[1]!.revision).toBe(next);
  });
});

/** 与业务层一致的 sha256 revision。 */
function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
