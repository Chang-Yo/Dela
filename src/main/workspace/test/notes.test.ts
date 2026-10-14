// 笔记文件能力的主进程行为：默认 .md、图片落盘 assets/、受限资源解析的边界、
// Markdown 副本携带图片、笔记移动时按原相对路径携带图片且正文不变、
// folder↔project 原地互转时的项目身份（条目 UUID + 项目目录）维护、
// 把电脑上已有的文件夹登记为项目（目录留在原处）。
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { shell } from 'electron';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => ({ root: '', execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: state.execFile, spawn: state.spawn }));
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: { openPath: vi.fn() } }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../canvas/api', () => ({ canvasFilePath: vi.fn(), readCanvasSource: vi.fn() }));
vi.mock('../../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));

import { getDatabase } from '../../database';
import { workspaceArchiveId } from '../../../shared/workspace';
import {
  createWorkspaceEntry,
  linkProjectFolder,
  readWorkspaceEntry,
  removeWorkspaceEntry,
  resolveWorkspaceAsset,
  saveNoteImage,
  saveWorkspaceNote,
  updateWorkspaceEntry,
  openProjectDirectory,
  getWorkspaceState,
  entry,
} from '../api';

const PNG: Uint8Array = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE remotes (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, host TEXT NOT NULL, port INTEGER,
      key_path TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX workspace_parent ON workspace_entries(parent_id);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
      file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertFileEntry(db: Database.Database, path: string, kind: 'local' | 'imported') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO workspace_entries VALUES (?, NULL, ?, ?, NULL, ?, NULL, ?)').run(
    id,
    path.split(/[\\/]/).pop()!,
    kind,
    path,
    new Date().toISOString(),
  );
  return id;
}

/** 工作区根目录（storageDirectory() 无自定义设置时为 <root>/Dela/workspace）。 */
const workspaceRoot = () => join(state.root, 'Dela', 'workspace');
const localPathOf = (id: string) => entry(id).path!;

/** VS Code 已安装的替身：where code 指向 bin/code.cmd，同安装目录有 Code.exe；启动只报成功。 */
function stubVsCode(): string {
  const code = join(state.root, 'VS Code', 'Code.exe');
  mkdirSync(dirname(code), { recursive: true });
  writeFileSync(code, '');
  state.execFile.mockImplementation((_command, _args, callback) => {
    callback(null, join(dirname(code), 'bin', 'code.cmd'));
  });
  state.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  return code;
}

/** 远端项目与它的连接记录（local_path 是远端 POSIX 路径，本地没有对应目录）。 */
function insertRemoteProject(host: string, path: string): string {
  const id = crypto.randomUUID();
  const remoteId = crypto.randomUUID();
  db.prepare('INSERT INTO remotes VALUES (?, ?, ?, NULL, NULL, ?)').run(
    remoteId,
    host,
    host,
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO workspace_entries VALUES (?, NULL, ?, ?, NULL, ?, ?, ?)').run(
    id,
    path.split('/').pop()!,
    'project',
    path,
    remoteId,
    new Date().toISOString(),
  );
  return id;
}

let db: Database.Database;

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-notes-'));
  db = createDb();
  vi.mocked(getDatabase).mockReturnValue(db);
});

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true });
});

describe('磁盘工作区', () => {
  it('外部创建的文件可发现、打开与保存，无需数据库条目或笔记身份', async () => {
    const project = createWorkspaceEntry({ parentId: null, name: '磁盘项目', kind: 'project' });
    const folder = join(localPathOf(project.id), 'shell-folder');
    mkdirSync(folder);
    const path = join(folder, 'shell.md');
    writeFileSync(path, '# shell');
    expect(getWorkspaceState().entries.find((item) => item.id === path)).toMatchObject({
      parentId: folder,
      kind: 'note',
    });
    const content = await readWorkspaceEntry(path);
    saveWorkspaceNote(path, '# edited', content.revision!);
    expect(readFileSync(path, 'utf8')).toBe('# edited');
    expect(db.prepare('SELECT count(*) AS n FROM workspace_entries').get()).toEqual({ n: 1 });
  });

  it('新建普通文件返回路径，重命名返回已有视图的路径映射', () => {
    const note = createWorkspaceEntry({ parentId: null, name: '普通', kind: 'note', text: 'file' });
    expect(note.id).toBe(join(workspaceRoot(), '普通.md'));
    const result = updateWorkspaceEntry(note.id, { name: '新名.md' });
    expect(result).toEqual({
      id: join(workspaceRoot(), '新名.md'),
      fromPath: note.id,
      toPath: join(workspaceRoot(), '新名.md'),
    });
    expect(existsSync(note.id)).toBe(false);
    expect(readFileSync(result.id, 'utf8')).toBe('file');
    expect(db.prepare('SELECT count(*) AS n FROM workspace_entries').get()).toEqual({ n: 0 });
  });
});

describe('移动中断后的恢复', () => {
  const pending = (from: string, to: string) =>
    db
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('storage-move', ?)")
      .run(JSON.stringify({ from, to, id: to, name: '新位置', parentId: null, kind: 'folder' }));
  const pendingMove = () =>
    db.prepare("SELECT value FROM workspace_settings WHERE key='storage-move'").get();

  it('磁盘已改名、数据库未提交：启动时补完移动并清除标记', () => {
    const project = createWorkspaceEntry({ parentId: null, name: '项目', kind: 'project' });
    const from = join(localPathOf(project.id), '旧位置');
    const to = join(localPathOf(project.id), '新位置');
    mkdirSync(to);
    pending(from, to);
    expect(() => getWorkspaceState()).not.toThrow();
    expect(pendingMove()).toBeUndefined();
  });

  it('磁盘尚未改名：放弃标记，原目录保留', () => {
    const project = createWorkspaceEntry({ parentId: null, name: '项目', kind: 'project' });
    const from = join(localPathOf(project.id), '旧位置');
    mkdirSync(from);
    pending(from, join(localPathOf(project.id), '新位置'));
    getWorkspaceState();
    expect(pendingMove()).toBeUndefined();
    expect(existsSync(from)).toBe(true);
  });

  it('两端都在或都不在：无法判断，拒绝继续修改文件', () => {
    const project = createWorkspaceEntry({ parentId: null, name: '项目', kind: 'project' });
    const from = join(localPathOf(project.id), '旧位置');
    const to = join(localPathOf(project.id), '新位置');
    mkdirSync(from);
    mkdirSync(to);
    pending(from, to);
    expect(() => getWorkspaceState()).toThrow(/文件移动尚未恢复/);
  });
});

describe('打开项目目录', () => {
  it('VS Code 接收完整路径参数，不经 shell 且不隐藏首次启动的窗口', async () => {
    if (process.platform !== 'win32') return;
    const project = createWorkspaceEntry({
      parentId: null,
      name: '项目 % & 中文',
      kind: 'project',
    });
    const code = stubVsCode();
    await openProjectDirectory(project.id, 'vscode');
    expect(state.spawn).toHaveBeenLastCalledWith(code, [join(workspaceRoot(), '项目 % & 中文')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  });

  it('远端项目经 Remote-SSH 打开远端路径，不交给本地 VS Code 当本地目录', async () => {
    if (process.platform !== 'win32') return;
    const project = insertRemoteProject('root@47.117.158.218', '/srv/app');
    const code = stubVsCode();
    vi.mocked(shell.openPath).mockClear();
    await openProjectDirectory(project, 'vscode');
    expect(state.spawn).toHaveBeenLastCalledWith(
      code,
      ['--remote', 'ssh-remote+root@47.117.158.218', '/srv/app'],
      { detached: true, stdio: 'ignore', windowsHide: false },
    );
    // 远端目录没有本地对应物，资源管理器无从打开。
    await expect(openProjectDirectory(project, 'explorer')).rejects.toThrow('没有本地目录');
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('未找到 VS Code 时提示远端项目需要 Remote - SSH 与 ssh config', async () => {
    if (process.platform !== 'win32') return;
    const project = insertRemoteProject('gpu-box', '/srv/app');
    state.execFile.mockImplementation((_command, _args, callback) => callback(null, ''));
    await expect(openProjectDirectory(project, 'vscode')).rejects.toThrow('Remote - SSH');
  });

  it('VS Code 进程启动失败时返回错误，供界面显示提示', async () => {
    const project = insertRemoteProject('gpu-box', '/srv/app');
    stubVsCode();
    state.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit('error', new Error('spawn EACCES')));
      return child;
    });
    await expect(openProjectDirectory(project, 'vscode')).rejects.toThrow(
      '启动 VS Code 失败：spawn EACCES',
    );
  });

  it('打开项目当前目录，重命名后使用新路径', async () => {
    const project = createWorkspaceEntry({
      parentId: null,
      name: '项目 % & 中文',
      kind: 'project',
    });
    vi.mocked(shell.openPath).mockResolvedValue('');
    await openProjectDirectory(project.id, 'explorer');
    expect(shell.openPath).toHaveBeenLastCalledWith(join(workspaceRoot(), '项目 % & 中文'));
    updateWorkspaceEntry(project.id, { name: '新项目' });
    await openProjectDirectory(project.id, 'explorer');
    expect(shell.openPath).toHaveBeenLastCalledWith(join(workspaceRoot(), '新项目'));
  });

  it('拒绝普通文件夹、无效项目 ID 和未知打开方式', async () => {
    const folder = createWorkspaceEntry({ parentId: null, name: '资料', kind: 'folder' });
    await expect(openProjectDirectory(folder.id, 'explorer')).rejects.toThrow('只有项目');
    await expect(openProjectDirectory('invalid', 'explorer')).rejects.toThrow();
    const project = createWorkspaceEntry({ parentId: null, name: '项目', kind: 'project' });
    await expect(openProjectDirectory(project.id, 'unknown')).rejects.toThrow();
  });

  it('系统打开失败时报告错误', async () => {
    const project = createWorkspaceEntry({ parentId: null, name: '项目', kind: 'project' });
    vi.mocked(shell.openPath).mockResolvedValueOnce('目录无法打开');
    await expect(openProjectDirectory(project.id, 'explorer')).rejects.toThrow('目录无法打开');
  });
});

describe('createWorkspaceEntry', () => {
  it('新笔记默认补 .md；显式扩展名时尊重用户选择', async () => {
    const note = createWorkspaceEntry({
      parentId: null,
      name: '会议记录',
      kind: 'note',
      text: '# 内容',
    });
    expect(note.name).toBe('会议记录.md');
    const content = await readWorkspaceEntry(note.id);
    expect(content.format).toBe('markdown');
    expect(content.text).toBe('# 内容');

    const code = createWorkspaceEntry({
      parentId: null,
      name: 'demo.cpp',
      kind: 'note',
      text: 'int main() {}',
    });
    expect(code.name).toBe('demo.cpp');
    expect((await readWorkspaceEntry(code.id)).format).toBe('text');
  });

  it('source 引用行的 local_path 是容器目录去重键，不改变该目录的条目身份', () => {
    const folder = createWorkspaceEntry({ parentId: null, name: '资料夹', kind: 'folder' });
    db.prepare(
      "INSERT INTO workspace_entries VALUES (?, NULL, '实验要求', 'source', 'assignment:4', ?, NULL, ?)",
    ).run(crypto.randomUUID(), folder.id, new Date().toISOString());
    expect(entry(folder.id).kind).toBe('folder');
    // 同容器继续创建内容不受影响（source 行曾把容器误判成 source 而拒绝操作）。
    const note = createWorkspaceEntry({
      parentId: folder.id,
      name: '笔记',
      kind: 'note',
      text: '',
    });
    expect(isAbsolute(note.id)).toBe(true);
  });
});

describe('归档文件夹', () => {
  const archivePath = () => join(workspaceRoot(), '归档');
  const seedArchive = () =>
    db
      .prepare(
        "INSERT INTO workspace_entries VALUES ('00000000-0000-4000-8000-000000000001', NULL, '归档', 'folder', NULL, NULL, NULL, '2026-10-07T00:00:00.000Z')",
      )
      .run();

  it('首次访问落定归档文件夹并持久化路径；重复访问不重建，条目列表不含归档行自身', () => {
    seedArchive();
    const state = getWorkspaceState();
    expect(entry(workspaceArchiveId).path).toBe(archivePath());
    expect(existsSync(archivePath())).toBe(true);
    expect(state.entries.find((item) => item.id === workspaceArchiveId)).toBeUndefined();
    // 重复访问不重建：路径不变；只有 local_path 悬空时才重新落定。
    getWorkspaceState();
    expect(entry(workspaceArchiveId).path).toBe(archivePath());
    rmSync(archivePath(), { recursive: true, force: true });
    db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(
      join(workspaceRoot(), '已丢失'),
      workspaceArchiveId,
    );
    getWorkspaceState();
    expect(entry(workspaceArchiveId).path).toBe(archivePath());
  });

  it('移入归档：目录落到归档文件夹下，条目挂在归档行', () => {
    seedArchive();
    const folder = createWorkspaceEntry({ parentId: null, name: '资料夹', kind: 'folder' });
    updateWorkspaceEntry(folder.id, { parentId: workspaceArchiveId });
    expect(existsSync(join(archivePath(), '资料夹'))).toBe(true);
    expect(
      getWorkspaceState().entries.find((item) => item.id === join(archivePath(), '资料夹')),
    ).toMatchObject({ parentId: workspaceArchiveId });
  });
});

describe('saveNoteImage / resolveWorkspaceAsset', () => {
  it('图片写入笔记目录 assets/，返回正斜杠相对路径，重名自动加序号', () => {
    const note = createWorkspaceEntry({ parentId: null, name: '带图笔记', kind: 'note', text: '' });
    expect(saveNoteImage(note.id, '截图.png', PNG)).toBe('assets/截图.png');
    expect(saveNoteImage(note.id, '截图.png', PNG)).toBe('assets/截图 (2).png');
    const resolved = resolveWorkspaceAsset(note.id, 'assets/截图.png');
    expect(resolved.mime).toBe('image/png');
    expect(existsSync(resolved.path)).toBe(true);
    // 中文与空格文件名（Windows 下载常见的"文件 (1)"样式）往返一致。
    expect(saveNoteImage(note.id, 'my pic (1).png', PNG)).toBe('assets/my pic (1).png');
    const spaced = resolveWorkspaceAsset(note.id, 'assets/my pic (1).png');
    expect(spaced.mime).toBe('image/png');
    expect(existsSync(spaced.path)).toBe(true);
  });

  it('拒绝越界路径、非图片扩展名与非笔记条目', () => {
    const note = createWorkspaceEntry({ parentId: null, name: '笔记', kind: 'note', text: '' });
    expect(() => resolveWorkspaceAsset(note.id, '../逃逸.png')).toThrow('资源路径超出文档目录');
    expect(() => resolveWorkspaceAsset(note.id, 'assets/notes.txt')).toThrow('不支持的图片格式');
    expect(() => saveNoteImage(note.id, 'a.exe', PNG)).toThrow('不支持的图片格式');

    const sourceDir = join(state.root, '来源');
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, '外部.png'), PNG);
    const importedId = insertFileEntry(db, join(sourceDir, '外部.png'), 'imported');
    expect(() => saveNoteImage(importedId, 'a.png', PNG)).toThrow('只有笔记可以插入图片');
    // 导入文件以自身目录为基准解析相对图片；向上跳出该目录的引用被拒绝。
    expect(resolveWorkspaceAsset(importedId, '外部.png').mime).toBe('image/png');
    writeFileSync(join(state.root, '逃逸.png'), PNG);
    expect(() => resolveWorkspaceAsset(importedId, '../逃逸.png')).toThrow('资源路径超出文档目录');
  });
});

describe('笔记移动携带图片', () => {
  it('移动到其他目录后图片按原相对路径可用，正文不改写', () => {
    const folderA = createWorkspaceEntry({ parentId: null, name: 'A', kind: 'folder' });
    const folderB = createWorkspaceEntry({ parentId: null, name: 'B', kind: 'folder' });
    const note = createWorkspaceEntry({
      parentId: folderA.id,
      name: '移动笔记',
      kind: 'note',
      text: '![图](assets/fig.png)\n',
    });
    saveNoteImage(note.id, 'fig.png', PNG);

    const move = updateWorkspaceEntry(note.id, { parentId: folderB.id });
    const moved = move.toPath!;
    expect(dirname(moved)).toBe(localPathOf(folderB.id));
    // 正文不变（草稿 revision 不受移动影响），图片已按原相对路径复制到位。
    expect(readFileSync(moved, 'utf8')).toBe('![图](assets/fig.png)\n');
    expect(existsSync(join(localPathOf(folderB.id), 'assets', 'fig.png'))).toBe(true);
    expect(existsSync(join(localPathOf(folderA.id), 'assets', 'fig.png'))).toBe(true);
    expect(resolveWorkspaceAsset(moved, 'assets/fig.png').mime).toBe('image/png');
  });
});

describe('saveWorkspaceNote 外部冲突', () => {
  it('revision 与磁盘不一致时拒绝保存且不改文件；一致时原子写入并返回新 revision', async () => {
    const note = createWorkspaceEntry({
      parentId: null,
      name: '冲突笔记',
      kind: 'note',
      text: 'v1',
    });
    const before = await readWorkspaceEntry(note.id);

    expect(() => saveWorkspaceNote(note.id, '被覆盖的内容', 'stale')).toThrow('外部修改');
    expect(readFileSync(localPathOf(note.id), 'utf8')).toBe('v1');

    const next = saveWorkspaceNote(note.id, 'v2', before.revision!);
    expect(readFileSync(localPathOf(note.id), 'utf8')).toBe('v2');
    expect(next).not.toBe(before.revision);
  });
});

describe('folder↔project 转换', () => {
  it('升格生成条目 UUID 并记录项目目录；转换伴随重命名时项目目录跟随移动，降格回到路径身份', () => {
    const folder = createWorkspaceEntry({ parentId: null, name: '课题', kind: 'folder' });
    expect(isAbsolute(folder.id)).toBe(true);
    const promoted = updateWorkspaceEntry(folder.id, { kind: 'project' });
    expect(promoted.id).not.toBe(folder.id);
    // 项目目录即 local_path：会话 cwd 从这里解析。
    expect(
      db.prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?').get(promoted.id),
    ).toEqual({ path: folder.id });
    // 升格后路径与 UUID 都解析到同一项目身份。
    expect(entry(folder.id)).toMatchObject({ id: promoted.id, kind: 'project' });

    // 转换伴随重命名：项目目录跟随移动。
    updateWorkspaceEntry(promoted.id, { name: '毕业设计' });
    expect(existsSync(join(workspaceRoot(), '毕业设计'))).toBe(true);
    expect(
      db.prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?').get(promoted.id),
    ).toEqual({ path: join(workspaceRoot(), '毕业设计') });

    // 降格回到路径身份，项目行随之消失。
    const demoted = updateWorkspaceEntry(promoted.id, { name: '归档课题', kind: 'folder' });
    expect(existsSync(join(workspaceRoot(), '归档课题'))).toBe(true);
    expect(isAbsolute(demoted.id)).toBe(true);
    expect(demoted.id).toBe(join(workspaceRoot(), '归档课题'));
    expect(
      db.prepare('SELECT 1 FROM workspace_entries WHERE id=?').get(promoted.id),
    ).toBeUndefined();
    expect(entry(demoted.id).kind).toBe('folder');
  });

  it('降格后项目会话经外键降级为通用', () => {
    const folder = createWorkspaceEntry({ parentId: null, name: '课题', kind: 'folder' });
    const promoted = updateWorkspaceEntry(folder.id, { kind: 'project' });
    const iso = '2026-09-29T00:00:00.000Z';
    db.prepare(
      'INSERT INTO sessions (id, project_id, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('s-1', promoted.id, '', iso, iso);
    updateWorkspaceEntry(promoted.id, { kind: 'folder' });
    expect(
      db.prepare('SELECT project_id AS projectId FROM sessions WHERE id=?').get('s-1'),
    ).toEqual({ projectId: null });
  });
});

describe('导入已有文件夹作为项目', () => {
  const external = () => join(state.root, 'external', '我的代码');

  beforeEach(() => {
    mkdirSync(external(), { recursive: true });
    writeFileSync(join(external(), 'README.md'), '# 我的代码');
  });

  it('目录留在原处，登记为项目并连同子文件出现在工作区状态里', () => {
    const project = linkProjectFolder(external());
    expect(project).toMatchObject({
      name: '我的代码',
      kind: 'project',
      parentId: null,
      path: external(),
    });
    // 项目身份 = 条目 UUID + local_path：会话 cwd 从这里解析，目录本身不搬动。
    expect(isAbsolute(project.id)).toBe(false);
    expect(
      db.prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?').get(project.id),
    ).toEqual({ path: external() });
    const entries = getWorkspaceState().entries;
    expect(entries.find((item) => item.id === project.id)).toMatchObject({ kind: 'project' });
    expect(entries.find((item) => item.id === join(external(), 'README.md'))).toMatchObject({
      parentId: project.id,
      kind: 'note',
    });
  });

  it('重复导入同一目录沿用已有身份；移除项目身份后目录保留', async () => {
    const first = linkProjectFolder(external());
    expect(linkProjectFolder(`${external()}${sep}`).id).toBe(first.id);
    expect(db.prepare('SELECT count(*) AS n FROM workspace_entries').get()).toEqual({ n: 1 });
    await removeWorkspaceEntry(first.id);
    expect(existsSync(join(external(), 'README.md'))).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM workspace_entries').get()).toEqual({ n: 0 });
  });

  it('拒绝文件、不存在的目录与工作区根目录本身', () => {
    expect(() => linkProjectFolder(join(external(), 'README.md'))).toThrow('请选择一个文件夹');
    expect(() => linkProjectFolder(join(state.root, 'missing'))).toThrow('请选择一个文件夹');
    mkdirSync(workspaceRoot(), { recursive: true });
    expect(() => linkProjectFolder(workspaceRoot())).toThrow('工作区目录');
  });
});
