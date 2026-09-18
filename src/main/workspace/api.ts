import { app } from 'electron';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { canvasFilePath, readCanvasSource } from '../canvas/api';
import { availablePath, storageDirectory as directory } from '../storage';
import { workspaceArchiveId } from '../../shared/api';
import { textFileExtensions } from '../../shared/chat-input';
import type {
  DocumentContent,
  WorkspaceCreateInput,
  WorkspaceEntry,
  WorkspaceState,
} from '../../shared/api';

export const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(200);
const entryColumns =
  'id, parent_id AS parentId, name, kind, source_id AS sourceId, note_id AS noteId, updated_at AS updatedAt';

// 笔记按扩展名区分为 Markdown 或普通文本；其余内容一律按文本读写。
const markdownExtensions = ['.md', '.markdown'];
// 本地/导入文件按 VSCode 对文本文件的宽泛处理内嵌展示；未列出的扩展仍不支持预览。
// 清单与助手 composer 附件共用（shared/chat-input.ts，无点小写）。
const textExtensions = new Set(textFileExtensions.map((extension) => `.${extension}`));

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function setting(key: string): string | null {
  return (
    (
      getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value ?? null
  );
}

function containerPath(parentId: string | null): string {
  if (parentId) return managedPath(entry(parentId))!;
  const root = join(directory(), 'workspace');
  mkdirSync(root, { recursive: true });
  return root;
}

function managedPath(item: WorkspaceEntry): string | null {
  if (!['folder', 'project', 'note', 'imported'].includes(item.kind)) return null;
  const db = getDatabase();
  const stored = db
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(item.id) as { path: string | null };
  if (stored.path) return stored.path;
  if (item.kind === 'imported') throw new Error('导入文件已丢失');
  const folder = item.kind !== 'note';
  const path = availablePath(containerPath(item.parentId), item.name, folder);
  if (folder) mkdirSync(path);
  else {
    const original = notePath(item);
    // Missing legacy files remain linked to their original location for recovery.
    if (!existsSync(original)) return original;
    copyFileSync(original, path, constants.COPYFILE_EXCL);
  }
  db.transaction(() => {
    if (!folder) db.prepare('UPDATE workspace_notes SET path=? WHERE id=?').run(path, item.noteId);
    db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(path, item.id);
  })();
  return path;
}

function migrateWorkspaceRoot() {
  const oldRoot = join(directory(), '工作区');
  const root = join(directory(), 'workspace');
  if (!existsSync(oldRoot) || existsSync(root)) return;
  renameSync(oldRoot, root);
  const replaceRoot = (path: string) => {
    const suffix = relative(oldRoot, path);
    return suffix === '' ||
      (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
      ? join(root, suffix)
      : path;
  };
  const db = getDatabase();
  db.transaction(() => {
    const entries = db
      .prepare('SELECT id, local_path AS path FROM workspace_entries WHERE local_path IS NOT NULL')
      .all() as { id: string; path: string }[];
    for (const item of entries) {
      const path = replaceRoot(item.path);
      if (path !== item.path)
        db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(path, item.id);
    }
    const notes = db.prepare('SELECT id, path FROM workspace_notes').all() as {
      id: string;
      path: string;
    }[];
    for (const note of notes) {
      const path = replaceRoot(note.path);
      if (path !== note.path)
        db.prepare('UPDATE workspace_notes SET path=? WHERE id=?').run(path, note.id);
    }
  })();
}

type PendingMove = {
  from: string;
  to: string;
  id: string;
  name: string;
  parentId: string | null;
  kind: string;
};

function finishMove(move: PendingMove) {
  const db = getDatabase();
  const relocate = (path: string) => {
    const suffix = relative(move.from, path);
    return suffix === ''
      ? move.to
      : !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
        ? join(move.to, suffix)
        : path;
  };
  db.transaction(() => {
    const rows = db
      .prepare('SELECT id, local_path AS path FROM workspace_entries WHERE local_path IS NOT NULL')
      .all() as { id: string; path: string }[];
    for (const row of rows) {
      const path = relocate(row.path);
      if (path !== row.path)
        db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(path, row.id);
    }
    const notes = db.prepare('SELECT id, path FROM workspace_notes').all() as {
      id: string;
      path: string;
    }[];
    for (const note of notes) {
      const path = relocate(note.path);
      if (path !== note.path)
        db.prepare('UPDATE workspace_notes SET path=? WHERE id=?').run(path, note.id);
    }
    db.prepare(
      'UPDATE workspace_entries SET name=?, parent_id=?, kind=?, updated_at=? WHERE id=?',
    ).run(move.name, move.parentId, move.kind, new Date().toISOString(), move.id);
    db.prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
  })();
}

export function prepareStorage() {
  migrateWorkspaceRoot();
  const pending = setting('storage-move');
  if (pending) {
    const move: PendingMove = JSON.parse(pending);
    if (!existsSync(move.from) && existsSync(move.to)) finishMove(move);
    else if (existsSync(move.from) && !existsSync(move.to))
      getDatabase().prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
    else throw new Error('文件移动尚未恢复，请检查原路径和目标路径，暂不继续修改文件。');
  }
  const items = getDatabase()
    .prepare(
      `SELECT ${entryColumns} FROM workspace_entries WHERE local_path IS NULL AND kind IN ('folder','project','note')`,
    )
    .all() as WorkspaceEntry[];
  if (items.length) {
    const backup = join(app.getPath('userData'), 'dela-before-storage-tree.db');
    if (!existsSync(backup)) getDatabase().exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  }
  for (const item of items) managedPath(item);
}

export function getWorkspaceState(): WorkspaceState {
  prepareStorage();
  const views = getDatabase()
    .prepare("SELECT key, value FROM workspace_settings WHERE key LIKE 'view:%'")
    .all() as { key: string; value: string }[];
  return {
    entries: getDatabase()
      .prepare(`SELECT ${entryColumns} FROM workspace_entries ORDER BY updated_at DESC`)
      .all() as WorkspaceEntry[],
    views: Object.fromEntries(views.map((v) => [v.key.slice(5), JSON.parse(v.value)])),
    directory: directory(),
  };
}

export function entry(id: string): WorkspaceEntry {
  const item = getDatabase()
    .prepare(`SELECT ${entryColumns} FROM workspace_entries WHERE id=?`)
    .get(id) as WorkspaceEntry | undefined;
  if (!item) throw new Error('内容不存在');
  return item;
}

function checkParent(parentId: string | null, movingId?: string) {
  const seen = new Set<string>();
  let current = parentId;
  while (current) {
    if (current === movingId || seen.has(current)) throw new Error('不能移入自身或子文件夹');
    seen.add(current);
    const parent = entry(current);
    if (parent.kind !== 'folder' && parent.kind !== 'project')
      throw new Error('请选择一个文件夹或项目');
    current = parent.parentId;
  }
}

export function createWorkspaceEntry(input: WorkspaceCreateInput): WorkspaceEntry {
  const parsed = z
    .object({
      parentId: idSchema.nullable(),
      name: nameSchema,
      kind: z.enum(['folder', 'project', 'note', 'source']),
      sourceId: z.string().max(512).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .parse(input);
  checkParent(parsed.parentId);
  prepareStorage();
  const db = getDatabase();
  if (parsed.kind === 'source') {
    if (
      !parsed.sourceId ||
      !db.prepare('SELECT 1 FROM canvas_sources WHERE id=?').get(parsed.sourceId)
    )
      throw new Error('资料不存在，请先同步课程');
    const duplicate = db
      .prepare(
        `SELECT ${entryColumns} FROM workspace_entries WHERE parent_id IS ? AND source_id=? AND kind='source'`,
      )
      .get(parsed.parentId, parsed.sourceId) as WorkspaceEntry | undefined;
    if (duplicate) return duplicate;
  }
  const id = randomUUID();
  const noteId = parsed.kind === 'note' ? randomUUID() : null;
  let path: string | null = null;
  if (parsed.kind !== 'source') {
    path = availablePath(containerPath(parsed.parentId), parsed.name, !noteId);
    if (noteId) writeFileSync(path, parsed.text ?? '', { flag: 'wx' });
    else mkdirSync(path);
  }
  db.transaction(() => {
    if (noteId) db.prepare('INSERT INTO workspace_notes VALUES (?, ?)').run(noteId, path);
    db.prepare('INSERT INTO workspace_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      parsed.parentId,
      parsed.name,
      parsed.kind,
      parsed.sourceId ?? null,
      noteId,
      path,
      new Date().toISOString(),
    );
  })();
  return entry(id);
}

export function updateWorkspaceEntry(id: string, input: unknown) {
  prepareStorage();
  const parsed = z
    .object({
      name: nameSchema.optional(),
      parentId: idSchema.nullable().optional(),
      kind: z.enum(['folder', 'project']).optional(),
    })
    .strict()
    .parse(input);
  const current = entry(id);
  if (id === workspaceArchiveId) throw new Error('归档文件夹不能修改');
  if (parsed.parentId !== undefined) checkParent(parsed.parentId, id);
  if (parsed.kind && current.kind !== 'folder' && current.kind !== 'project')
    throw new Error('只有文件夹可以作为项目开展');
  const from = managedPath(current);
  const name = parsed.name ?? current.name;
  const parentId = parsed.parentId === undefined ? current.parentId : parsed.parentId;
  if (from && (name !== current.name || parentId !== current.parentId)) {
    const parent = parentId === current.parentId ? dirname(from) : containerPath(parentId);
    const to = availablePath(parent, name, current.kind !== 'note');
    const move: PendingMove = { from, to, id, name, parentId, kind: parsed.kind ?? current.kind };
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('storage-move', ?)")
      .run(JSON.stringify(move));
    try {
      renameSync(from, to);
    } catch (error) {
      getDatabase().prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
      throw error;
    }
    finishMove(move);
    return;
  }
  getDatabase()
    .prepare('UPDATE workspace_entries SET name=?, parent_id=?, kind=?, updated_at=? WHERE id=?')
    .run(
      parsed.name ?? current.name,
      parsed.parentId === undefined ? current.parentId : parsed.parentId,
      parsed.kind ?? current.kind,
      new Date().toISOString(),
      id,
    );
}

export function importWorkspaceFiles(parentId: string | null, paths: string[]): WorkspaceEntry[] {
  checkParent(parentId);
  prepareStorage();
  const imported: { id: string; name: string; path: string }[] = [];
  try {
    for (const source of paths) {
      const path = availablePath(containerPath(parentId), basename(source), false);
      copyFileSync(source, path, constants.COPYFILE_EXCL);
      imported.push({ id: randomUUID(), name: basename(path), path });
    }
    const db = getDatabase();
    db.transaction(() => {
      for (const item of imported)
        db.prepare('INSERT INTO workspace_entries VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)').run(
          item.id,
          parentId,
          item.name,
          'imported',
          item.path,
          new Date().toISOString(),
        );
    })();
    return imported.map((item) => entry(item.id));
  } catch (error) {
    for (const item of imported) if (existsSync(item.path)) unlinkSync(item.path);
    throw error;
  }
}

export function notePath(item: WorkspaceEntry): string {
  const note = getDatabase()
    .prepare('SELECT path FROM workspace_notes WHERE id=?')
    .get(item.noteId) as { path: string } | undefined;
  if (!note) throw new Error('笔记不存在');
  return note.path;
}

export function workspacePdfPath(id: string): string {
  prepareStorage();
  const item = entry(idSchema.parse(id));
  if (item.kind !== 'local' && item.kind !== 'imported') throw new Error('文档不是本地 PDF');
  const stored = getDatabase()
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(id) as { path: string };
  if (extname(stored.path).toLowerCase() !== '.pdf') throw new Error('文档不是本地 PDF');
  return stored.path;
}

export async function workspaceFilePath(id: string): Promise<string> {
  prepareStorage();
  const item = entry(idSchema.parse(id));
  if (item.kind === 'note') return notePath(item);
  if (item.kind === 'source' && item.sourceId) return canvasFilePath(item.sourceId);
  if (item.kind !== 'local' && item.kind !== 'imported') throw new Error('条目不是文件');
  const stored = getDatabase()
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(id) as { path: string | null };
  if (!stored.path || !statSync(stored.path).isFile()) throw new Error('文件不存在');
  return stored.path;
}

export async function readWorkspaceEntry(id: string): Promise<DocumentContent> {
  prepareStorage();
  const item = entry(id);
  if (item.kind === 'source' && item.sourceId) return readCanvasSource(item.sourceId);
  if (item.kind === 'note') {
    const path = notePath(item);
    const text = readFileSync(path, 'utf8');
    // 笔记由应用以 UTF-8 文本写入，任意名称都可作为文本打开；Markdown 扩展名才有预览。
    return {
      title: item.name,
      format: markdownExtensions.includes(extname(path).toLowerCase()) ? 'markdown' : 'text',
      text,
      revision: hash(text),
    };
  }
  if (item.kind === 'local' || item.kind === 'imported') {
    const stored = getDatabase()
      .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
      .get(id) as { path: string };
    const ext = extname(stored.path).toLowerCase();
    const format =
      ext === '.pdf'
        ? 'pdf'
        : ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)
          ? 'image'
          : textExtensions.has(ext)
            ? 'text'
            : 'unsupported';
    if (format === 'unsupported') return { title: item.name, format };
    const stats = statSync(stored.path);
    if (format === 'pdf')
      return {
        title: item.name,
        format,
        previewUrl: `dela-resource://workspace/${encodeURIComponent(id)}?v=${stats.mtimeMs}-${stats.size}`,
        mime: 'application/pdf',
        revision: `${stats.mtimeMs}-${stats.size}`,
      };
    if (stats.size > 128 * 1024 * 1024) throw new Error('文件较大，请在外部应用中打开');
    const bytes = readFileSync(stored.path);
    return {
      title: item.name,
      format,
      text: format === 'text' ? bytes.toString('utf8') : undefined,
      bytes: format === 'text' ? undefined : new Uint8Array(bytes),
      mime: format === 'image' ? `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}` : undefined,
    };
  }
  throw new Error('请选择要打开的文档');
}

export function saveWorkspaceNote(id: string, text: string, revision: string): string {
  prepareStorage();
  const item = entry(id);
  if (item.kind !== 'note') throw new Error('只有笔记可以编辑');
  const path = notePath(item);
  const disk = readFileSync(path, 'utf8');
  if (hash(disk) !== revision)
    throw new Error('笔记已在外部修改。你的草稿仍在，请另存为新笔记或重新载入后编辑。');
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  getDatabase()
    .prepare('UPDATE workspace_entries SET updated_at=? WHERE note_id=?')
    .run(new Date().toISOString(), item.noteId);
  return hash(text);
}

export function removeWorkspaceEntry(value: unknown) {
  const id = idSchema.parse(value);
  if (id === workspaceArchiveId) throw new Error('归档文件夹不能移除');
  entry(id);
  // Only remove application references. Notes and imported files stay on disk.
  getDatabase().prepare('DELETE FROM workspace_entries WHERE id=?').run(id);
}

export function saveWorkspaceView(scope: unknown, input: unknown) {
  const key = z.string().max(100).parse(scope);
  const state = z
    .object({
      tabs: z.array(z.string().max(512)).max(100),
      active: z.string().max(512).nullable(),
      expanded: z.array(z.string().max(512)).max(10000),
      scroll: z.record(z.string().max(512), z.number().nonnegative()),
    })
    .parse(input);
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(`view:${key}`, JSON.stringify(state));
}
