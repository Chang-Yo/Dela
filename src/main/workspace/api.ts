import { shell } from 'electron';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { remoteById, targetOf } from '../remotes/api';
import { locate } from '../remotes/transport';
import { canvasFilePath, readCanvasSource } from '../canvas/api';
import { readShuiyuanSource } from '../shuiyuan/api';
import { availablePath, diskName, storageDirectory as directory } from '../storage';
import { officeExportPreviewInfo, readOfficeExportLink } from '../documents/links';
import { officeZipMime } from '../documents/parse';
import { workspaceArchiveId } from '../../shared/api';
import { parseRemoteNodeId } from '../../shared/remotes';
import { workspaceEntryIdSchema, type WorkspaceEntryUpdate } from '../../shared/workspace';
import { imageMimeOf } from '../../shared/files';
import {
  decodeAssetPath,
  isRelativeAssetPath,
  matchMarkdownImageRefs,
} from '../../shared/note-files';
import { localFileFormat, readLocalText, textRevision, writeLocalText } from './files';
import type {
  DocumentContent,
  WorkspaceCreateInput,
  WorkspaceEntry,
  WorkspaceState,
} from '../../shared/api';

export const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(200);
const entryColumns =
  'id, parent_id AS parentId, name, kind, source_id AS sourceId, remote_id AS remoteId, updated_at AS updatedAt';

// 插入图片的大小上限（与助手内联图片的常规体积一致量级）。
const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** 图片整张读进主进程再交给 renderer：超过就请用户在外部打开。 */
const IMAGE_READ_MAX_BYTES = 50 * 1024 * 1024;

function entryLocalPath(item: WorkspaceEntry): string {
  if (item.path) return item.path;
  const stored = getDatabase()
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(item.id) as { path: string | null };
  if (!stored.path) throw new Error('文件不存在');
  return stored.path;
}

type RemoteRoot = { id: string; path: string; remoteId: string };

function remoteRoots(): RemoteRoot[] {
  return getDatabase()
    .prepare(
      `SELECT id, local_path AS path, remote_id AS remoteId FROM workspace_entries
       WHERE remote_id IS NOT NULL AND kind='project' AND local_path IS NOT NULL`,
    )
    .all() as RemoteRoot[];
}

const underRemoteRoot = (root: string, path: string) => {
  const base = root.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
};

/** 条目（项目 UUID、带项目身份的远端条目 id，或裸远端绝对路径）所属的远程项目根；
 *  本地条目返回 null。所有会碰本地文件系统的入口都必须先问这里：远端路径 `/root/x`
 *  在 Windows 上会被 isAbsolute 判真并解析成 `E:\root\x`，直接 statSync 就是读错位置。 */
export function remoteProjectOf(id: string): RemoteRoot | null {
  const roots = remoteRoots();
  const byId = roots.find((root) => root.id === id);
  if (byId) return byId;
  // 远端条目 id 自带项目身份：两台连接上的同路径目录不会互相认领。
  const node = parseRemoteNodeId(id);
  if (node) {
    const owner = roots.find((root) => root.id === node.projectId);
    return owner && underRemoteRoot(owner.path, node.path) ? owner : null;
  }
  // 裸远端路径只在唯一匹配时归属：多个项目都装得下它时宁可报错也不猜。
  const normalized = id.replace(/\\/g, '/');
  const matches = roots.filter((root) => underRemoteRoot(root.path, normalized));
  if (matches.length > 1) throw new Error('远端路径同时属于多个项目，无法确定归属');
  return matches[0] ?? null;
}

/** 把远端目录登记为远程项目。目录留在远端，本地只补一条身份行；
 *  项目与子条目的 `local_path` 是远端 POSIX 路径，`remoteId` 指向连接。 */
export async function importRemoteProject(
  remoteId: unknown,
  path: unknown,
): Promise<WorkspaceEntry> {
  const connection = remoteById(z.string().uuid().parse(remoteId));
  const remotePath = z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value.startsWith('/') && !value.includes('\0'), {
      message: '远端项目路径必须是绝对路径',
    })
    .parse(path)
    .replace(/\/+$/, '');
  const location = await locate(targetOf(connection), remotePath);
  if (!location.directory) throw new Error(`远端目录不存在：${remotePath}`);
  const database = getDatabase();
  // 同一远端目录只登记一次：重复导入返回已有项目。
  const existing = database
    .prepare(
      `SELECT ${entryColumns}, local_path AS path FROM workspace_entries
       WHERE remote_id=? AND local_path=? AND kind='project'`,
    )
    .get(connection.id, remotePath) as WorkspaceEntry | undefined;
  if (existing) return existing;
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, remote_id, updated_at)
       VALUES (?, NULL, ?, 'project', NULL, ?, ?, ?)`,
    )
    .run(
      id,
      posix.basename(remotePath) || remotePath,
      remotePath,
      connection.id,
      new Date().toISOString(),
    );
  return entry(id);
}

/** 图片/笔记资源的解析结果：受限资源协议按它读取文件，只服务图片格式。 */
export function resolveWorkspaceAsset(id: string, ref: string): { path: string; mime: string } {
  const item = entry(id);
  if (item.kind !== 'file') throw new Error('此条目没有本地目录');
  const base = dirname(entryLocalPath(item));
  const path = join(base, ...ref.split('/'));
  const within = relative(base, path);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('资源路径超出文档目录');
  const mime = imageMimeOf(path);
  if (!mime) throw new Error('不支持的图片格式');
  if (!statSync(path).isFile()) throw new Error('图片文件不存在');
  return { path, mime };
}

/** 新插入的本地图片保存到 Markdown 文件同目录的 assets/ 下，返回可写入正文的相对路径。 */
export function saveNoteImage(id: string, name: string, bytes: Uint8Array): string {
  prepareStorage();
  const item = entry(id);
  if (item.kind !== 'file' || localFileFormat(entryLocalPath(item)) !== 'markdown')
    throw new Error('只有 Markdown 文件可以插入图片');
  const noteDir = dirname(entryLocalPath(item));
  if (bytes.byteLength > NOTE_IMAGE_MAX_BYTES) throw new Error('图片超过 20MB，无法保存');
  if (!imageMimeOf(name)) throw new Error('不支持的图片格式');
  const assets = join(noteDir, 'assets');
  mkdirSync(assets, { recursive: true });
  const path = availablePath(assets, name, false);
  writeFileSync(path, bytes);
  return relative(noteDir, path).split(sep).join('/');
}

/** 笔记移动到其他目录时，把正文引用的相对图片按原相对路径复制过去；正文不改写。 */
function carryNoteAssets(fromFile: string, toFile: string, text: string): void {
  const fromDir = dirname(fromFile);
  const toDir = dirname(toFile);
  if (fromDir === toDir) return;
  const root = join(directory(), 'workspace');
  const inside = (path: string) => {
    const within = relative(root, path);
    return !within.startsWith('..') && !isAbsolute(within);
  };
  for (const ref of matchMarkdownImageRefs(text)) {
    if (!isRelativeAssetPath(ref.path)) continue;
    const relativePath = decodeAssetPath(ref.path);
    const source = join(fromDir, ...relativePath.split('/'));
    if (!existsSync(source) || !statSync(source).isFile()) continue;
    if (!inside(source)) continue; // 工作区外的引用不携带
    const target = join(toDir, ...relativePath.split('/'));
    if (existsSync(target) || !inside(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  }
}

/** 项目目录只由 main 根据条目身份解析：条目必须是项目（升格后带数据库行），
 * 纯路径文件夹与文件不能经此入口打开。 */
export function projectDirectory(id: unknown): string {
  const projectId = workspaceEntryIdSchema.parse(id);
  prepareStorage();
  const item = entry(projectId);
  if (item.kind !== 'project') throw new Error('只有项目可以使用此入口');
  if (remoteProjectOf(projectId)) throw new Error('远程项目没有本地目录');
  const path = entryLocalPath(item);
  if (!statSync(path).isDirectory()) throw new Error('项目目录不存在');
  return path;
}

/** 项目位置：本地项目给出磁盘目录，远程项目给出远端路径与连接。
 *  terminal、会话 cwd 与目录树都经这里分支，避免把远端路径当本地目录使用。 */
export function projectLocation(
  id: unknown,
): { kind: 'local'; path: string } | { kind: 'remote'; remoteId: string; path: string } {
  const projectId = workspaceEntryIdSchema.parse(id);
  const root = remoteProjectOf(projectId);
  if (root) return { kind: 'remote', remoteId: root.remoteId, path: root.path };
  return { kind: 'local', path: projectDirectory(projectId) };
}

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
  if (item.path) return item.path;
  if (item.kind !== 'project' && item.kind !== 'source') return null;
  const stored = getDatabase()
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(item.id) as { path: string | null };
  return stored.path;
}

/** 根目录迁移/移动后，把库里记录的所有受管路径改写到新位置之下；须在调用方事务内执行。 */
function rewriteStoredPaths(from: string, to: string) {
  const db = getDatabase();
  const relocate = (path: string) => {
    const suffix = relative(from, path);
    return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
      ? join(to, suffix)
      : path;
  };
  const entries = db
    .prepare('SELECT id, local_path AS path FROM workspace_entries WHERE local_path IS NOT NULL')
    .all() as { id: string; path: string }[];
  for (const item of entries) {
    const path = relocate(item.path);
    if (path !== item.path)
      db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(path, item.id);
  }
}

function migrateWorkspaceRoot() {
  const oldRoot = join(directory(), '工作区');
  const root = join(directory(), 'workspace');
  if (!existsSync(oldRoot) || existsSync(root)) return;
  renameSync(oldRoot, root);
  getDatabase().transaction(() => rewriteStoredPaths(oldRoot, root))();
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
  db.transaction(() => {
    rewriteStoredPaths(move.from, move.to);
    db.prepare(
      'UPDATE workspace_entries SET name=?, parent_id=?, kind=?, updated_at=? WHERE id=?',
    ).run(move.name, move.parentId, move.kind, new Date().toISOString(), move.id);
    db.prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
  })();
}

/** 归档文件夹身份：种子行 local_path 缺失或目录丢失时重新落定（复用根目录已有「归档」，否则创建）。
 *  只在行存在时生效（内存测试库无种子行）。路径落定一次后只读，改名/移除另有守卫。 */
function ensureArchiveFolder() {
  const db = getDatabase();
  const stored = db
    .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
    .get(workspaceArchiveId) as { path: string | null } | undefined;
  if (!stored) return;
  if (stored.path && existsSync(stored.path)) return;
  const path = join(containerPath(null), '归档');
  if (!existsSync(path)) mkdirSync(path);
  db.prepare('UPDATE workspace_entries SET local_path=? WHERE id=?').run(path, workspaceArchiveId);
}

export function prepareStorage() {
  migrateWorkspaceRoot();
  ensureArchiveFolder();
  const pending = setting('storage-move');
  if (pending) {
    const move: PendingMove = JSON.parse(pending);
    if (!existsSync(move.from) && existsSync(move.to)) finishMove(move);
    else if (existsSync(move.from) && !existsSync(move.to))
      getDatabase().prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
    else throw new Error('文件移动尚未恢复，请检查原路径和目标路径，暂不继续修改文件。');
  }
}

export function getWorkspaceState(): WorkspaceState {
  prepareStorage();
  const stored = getDatabase()
    .prepare(`SELECT ${entryColumns}, local_path AS path FROM workspace_entries`)
    .all() as WorkspaceEntry[];
  const root = containerPath(null);
  const entries: WorkspaceEntry[] = [];
  const paths = new Map(
    stored
      .filter((item) => item.kind === 'project' || item.id === workspaceArchiveId)
      .filter((item) => item.path)
      .map((item) => [resolve(item.path!), item]),
  );
  const visited = new Set<string>();
  const scan = (path: string, parentId: string | null) => {
    path = resolve(path);
    if (visited.has(path)) return;
    let item: WorkspaceEntry;
    try {
      item = fileEntry(path, parentId, paths.get(path));
    } catch {
      return;
    }
    visited.add(path);
    entries.push(item);
    if (item.kind !== 'folder' && item.kind !== 'project') return;
    // 保留目录入口，避免递归遍历工具生成的依赖与 Git 数据。
    if (['node_modules', '.git'].includes(item.name)) return;
    let children;
    try {
      children = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      scan(join(path, child.name), item.id);
    }
  };
  for (const child of readdirSync(root, { withFileTypes: true }))
    if (!child.isSymbolicLink()) scan(join(root, child.name), null);
  // 更改默认保存目录不会迁移旧目录；旧挂载点继续可见。
  // 远程项目跳过本地扫描：它们的 local_path 是远端路径，本地没有对应文件；
  // 子条目由渲染端展开时经 workspace:list-remote 逐层拉取。
  for (const item of stored)
    if (item.kind !== 'source' && item.path && !item.remoteId && !visited.has(resolve(item.path)))
      scan(item.path, null);
  for (const item of stored)
    if (item.remoteId)
      entries.push({ ...item, parentId: null, path: item.path, updatedAt: item.updatedAt });
  const parentOf = (item: WorkspaceEntry): string | null => {
    const path =
      item.path ??
      (item.parentId ? stored.find((parent) => parent.id === item.parentId)?.path : undefined);
    return path ? (entries.find((parent) => parent.path === path)?.id ?? null) : null;
  };
  for (const item of stored.filter((item) => item.kind === 'source'))
    entries.push({ ...item, path: undefined, parentId: parentOf(item) });
  const views = getDatabase()
    .prepare("SELECT key, value FROM workspace_settings WHERE key LIKE 'view:%'")
    .all() as { key: string; value: string }[];
  return {
    // 归档文件夹自身不进条目列表（资料树只经归档区呈现它，子条目仍带其 parentId）。
    entries: entries.filter((item) => item.id !== workspaceArchiveId),
    views: Object.fromEntries(views.map((v) => [v.key.slice(5), JSON.parse(v.value)])),
    directory: directory(),
  };
}

export function entry(id: string): WorkspaceEntry {
  workspaceEntryIdSchema.parse(id);
  if (isAbsolute(id)) {
    // 远端路径在 Windows 上同样过 isAbsolute，必须先挡下来：本地没有这个文件。
    if (remoteProjectOf(id)) throw new Error('远程条目请通过远程接口访问，本地没有对应文件');
    // 路径条目可能有数据库身份（升格的项目、资料引用、旧 UUID 行）：按 local_path 匹配，
    // 命中时沿用其 id 与 kind，未命中即纯磁盘文件夹/文件。source 行的 local_path 是其
    // 容器目录路径（去重键），不代表该目录的身份，必须排除，否则容器会被误判成 source。
    const stored = getDatabase()
      .prepare(
        `SELECT ${entryColumns}, local_path AS path FROM workspace_entries WHERE local_path=? AND kind != 'source'`,
      )
      .get(resolve(id)) as WorkspaceEntry | undefined;
    return fileEntry(resolve(id), stored?.parentId ?? null, stored);
  }
  const item = getDatabase()
    .prepare(`SELECT ${entryColumns}, local_path AS path FROM workspace_entries WHERE id=?`)
    .get(id) as WorkspaceEntry | undefined;
  if (!item) throw new Error('内容不存在');
  return item;
}

function fileEntry(
  path: string,
  parentId: string | null = null,
  stored?: WorkspaceEntry,
): WorkspaceEntry {
  const stats = statSync(path);
  if (!stats.isDirectory() && !stats.isFile()) throw new Error('条目不是普通文件');
  return {
    id: stored?.id ?? path,
    parentId,
    name: basename(path),
    kind: stats.isDirectory() ? (stored?.kind ?? 'folder') : 'file',
    sourceId: null,
    path,
    updatedAt: stats.mtime.toISOString(),
  };
}

function checkParent(parentId: string | null, movingId?: string) {
  if (parentId && movingId) {
    const from = entryLocalPath(entry(movingId));
    const target = entryLocalPath(entry(parentId));
    const suffix = relative(from, target);
    if (!suffix || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)))
      throw new Error('不能移入自身或子文件夹');
  }
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

/** 新建名里的 `/`、`\` 是路径分隔符（与 VS Code 一致）：`a/b.md` 建出文件夹 a 与其中的 b.md，
 *  中间的文件夹已存在就复用。每段单独过 diskName（Windows 保留名、非法字符仍会被替换），
 *  `.` 与 `..` 段直接拒绝，结果因此必定落在父目录之内；以分隔符结尾（`aaa/`）一律建文件夹。
 *  最后一段已存在时报错而不是自动改名：名字是用户明确敲进来的，悄悄变成「b (2).md」不如让他改。 */
function createAtPath(
  parentId: string | null,
  name: string,
  kind: 'folder' | 'file',
  text?: string,
): WorkspaceEntry {
  const folder = kind === 'folder' || /[\\/]$/.test(name);
  const segments = name.split(/[\\/]+/).filter(Boolean);
  if (!segments.length) throw new Error('请输入名称');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    throw new Error('名称不能包含「.」或「..」路径段');
  let directory = containerPath(parentId);
  let parent = parentId;
  for (const segment of segments.slice(0, -1)) {
    directory = join(directory, diskName(segment));
    const stats = statSync(directory, { throwIfNoEntry: false });
    if (stats && !stats.isDirectory()) throw new Error(`「${segment}」已存在且不是文件夹`);
    if (!stats) mkdirSync(directory);
    parent = directory;
  }
  const path = join(directory, diskName(segments.at(-1)!));
  if (existsSync(path)) throw new Error(`「${basename(path)}」已存在`);
  if (folder) mkdirSync(path);
  else writeFileSync(path, text ?? '', { flag: 'wx' });
  return fileEntry(path, parent);
}

export function createWorkspaceEntry(input: WorkspaceCreateInput): WorkspaceEntry {
  const parsed = z
    .object({
      parentId: workspaceEntryIdSchema.nullable(),
      name: nameSchema,
      kind: z.enum(['folder', 'project', 'file', 'source']),
      sourceId: z.string().max(512).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .parse(input);
  checkParent(parsed.parentId);
  prepareStorage();
  if (parsed.parentId && remoteProjectOf(parsed.parentId))
    throw new Error('远程项目内暂不支持新建文件与文件夹');
  const db = getDatabase();
  if (parsed.kind === 'source') {
    // 来源引用按前缀区分平台：水源引用行落表，其余仍是 Canvas 资料表。
    if (parsed.sourceId?.startsWith('shuiyuan-topic:')) {
      const topicId = Number(parsed.sourceId.slice('shuiyuan-topic:'.length));
      if (
        !Number.isInteger(topicId) ||
        topicId <= 0 ||
        !db.prepare('SELECT 1 FROM shuiyuan_topics WHERE topic_id=?').get(topicId)
      )
        throw new Error('水源帖子引用不存在，请回到水源页重新添加');
    } else if (
      !parsed.sourceId ||
      !db.prepare('SELECT 1 FROM canvas_sources WHERE id=?').get(parsed.sourceId)
    )
      throw new Error('资料不存在，请先同步课程');
    const duplicate = db
      .prepare(
        `SELECT ${entryColumns} FROM workspace_entries WHERE (local_path=? OR (local_path IS NULL AND parent_id IS ?)) AND source_id=? AND kind='source'`,
      )
      .get(containerPath(parsed.parentId), parsed.parentId, parsed.sourceId) as
      WorkspaceEntry | undefined;
    if (duplicate) return duplicate;
  }
  if (parsed.kind === 'folder' || parsed.kind === 'file')
    return createAtPath(parsed.parentId, parsed.name, parsed.kind, parsed.text);
  const id = randomUUID();
  let path: string | null = null;
  if (parsed.kind === 'project') {
    path = availablePath(containerPath(parsed.parentId), parsed.name, true);
    parsed.name = basename(path);
    mkdirSync(path);
  }
  db.transaction(() => {
    db.prepare(
      `INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      parsed.parentId && !isAbsolute(parsed.parentId) ? parsed.parentId : null,
      parsed.name,
      parsed.kind,
      parsed.sourceId ?? null,
      parsed.kind === 'source' ? containerPath(parsed.parentId) : path,
      new Date().toISOString(),
    );
  })();
  return entry(id);
}

/** 把电脑上已有的文件夹登记为项目：目录留在原处，只补一条项目身份行。
 *  身份与受管项目完全等价，因此重命名、移动都会真的动这个目录。 */
export function linkProjectFolder(path: unknown): WorkspaceEntry {
  const resolved = resolve(z.string().min(1).max(32_767).parse(path));
  prepareStorage();
  if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory())
    throw new Error('请选择一个文件夹');
  if (resolved === resolve(containerPath(null)))
    throw new Error('这是 Dela 的工作区目录本身，请在其中新建项目');
  const db = getDatabase();
  // 同一目录只登记一次：重复导入返回已有项目，不产生两个身份。
  const existing = db
    .prepare(
      `SELECT ${entryColumns}, local_path AS path FROM workspace_entries WHERE local_path=? AND kind='project'`,
    )
    .get(resolved) as WorkspaceEntry | undefined;
  if (existing) return existing;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    null,
    basename(resolved) || resolved,
    'project',
    null,
    resolved,
    new Date().toISOString(),
  );
  return entry(id);
}

export function updateWorkspaceEntry(id: string, input: unknown): WorkspaceEntryUpdate {
  prepareStorage();
  const parsed = z
    .object({
      name: nameSchema.optional(),
      parentId: workspaceEntryIdSchema.nullable().optional(),
      kind: z.enum(['folder', 'project']).optional(),
    })
    .strict()
    .parse(input);
  const current = entry(id);
  if (id === workspaceArchiveId) throw new Error('归档文件夹不能修改');
  if (remoteProjectOf(id)) throw new Error('远程项目暂不支持重命名或移动');
  if (parsed.parentId !== undefined)
    checkParent(parsed.parentId, current.kind === 'source' ? undefined : id);
  if (parsed.kind && current.kind !== 'folder' && current.kind !== 'project')
    throw new Error('只有文件夹可以作为项目开展');
  if (current.kind === 'source') {
    getDatabase()
      .prepare(
        'UPDATE workspace_entries SET name=?, parent_id=NULL, local_path=?, updated_at=? WHERE id=?',
      )
      .run(
        parsed.name ?? current.name,
        parsed.parentId === undefined
          ? (current.path ?? containerPath(current.parentId))
          : containerPath(parsed.parentId),
        new Date().toISOString(),
        id,
      );
    return { id };
  }
  const from = managedPath(current)!;
  const name = parsed.name ?? current.name;
  const parentId = parsed.parentId === undefined ? current.parentId : parsed.parentId;
  let to = from;
  if (name !== current.name || parsed.parentId !== undefined) {
    const parent = parentId === current.parentId ? dirname(from) : containerPath(parentId);
    to = availablePath(parent, name, statSync(from).isDirectory());
    if (parent === dirname(from) && name === current.name) to = from;
    const move: PendingMove = {
      from,
      to,
      id,
      name,
      parentId: parentId && !isAbsolute(parentId) ? parentId : null,
      kind: parsed.kind ?? current.kind,
    };
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('storage-move', ?)")
      .run(JSON.stringify(move));
    try {
      // Markdown 移动前快照正文，移动后按原相对路径携带图片；正文不改写，草稿 revision 不受影响。
      const noteText =
        current.kind === 'file' && localFileFormat(from) === 'markdown'
          ? readFileSync(from, 'utf8')
          : null;
      if (from !== to) renameSync(from, to);
      if (noteText !== null) carryNoteAssets(from, to, noteText);
    } catch (error) {
      getDatabase().prepare("DELETE FROM workspace_settings WHERE key='storage-move'").run();
      throw error;
    }
    finishMove(move);
  }
  if (!isAbsolute(id))
    getDatabase()
      .prepare('UPDATE workspace_entries SET name=?, parent_id=?, kind=?, updated_at=? WHERE id=?')
      .run(
        name,
        parentId && !isAbsolute(parentId) ? parentId : null,
        parsed.kind ?? current.kind,
        new Date().toISOString(),
        id,
      );
  let nextId = isAbsolute(id) ? to : id;
  if (parsed.kind === 'project' && current.kind === 'folder') {
    // 升格：纯路径文件夹补建条目行（项目身份 = 条目 UUID + local_path）；已有行只改 kind。
    if (isAbsolute(current.id)) {
      const promoted = randomUUID();
      getDatabase()
        .prepare(
          `INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
           VALUES (?, NULL, ?, ?, NULL, ?, ?)`,
        )
        .run(promoted, basename(to), 'project', to, new Date().toISOString());
      nextId = promoted;
    } else {
      nextId = current.id;
      getDatabase().prepare("UPDATE workspace_entries SET kind='project' WHERE id=?").run(nextId);
    }
  } else if (parsed.kind === 'folder' && current.kind === 'project') {
    // 降格：删除条目行（项目会话经 FK 转为通用），目录回到纯路径身份。
    getDatabase().prepare('DELETE FROM workspace_entries WHERE id=?').run(current.id);
    nextId = to;
  }
  return { id: nextId, ...(from !== to ? { fromPath: from, toPath: to } : {}) };
}

export function importWorkspaceFiles(parentId: string | null, paths: string[]): WorkspaceEntry[] {
  checkParent(parentId);
  // 远端项目的 local_path 是远端的 POSIX 路径：拿它当本地目录写会落到 `\home\u\…` 这种地方。
  if (parentId && remoteProjectOf(parentId))
    throw new Error('远程项目内暂不支持导入本地文件，请拖到远端目录上上传');
  prepareStorage();
  const imported: { id: string; name: string; path: string }[] = [];
  try {
    for (const source of paths) {
      const path = availablePath(containerPath(parentId), basename(source), false);
      copyFileSync(source, path, constants.COPYFILE_EXCL);
      imported.push({ id: randomUUID(), name: basename(path), path });
    }
    return imported.map((item) => fileEntry(item.path, parentId));
  } catch (error) {
    for (const item of imported) if (existsSync(item.path)) unlinkSync(item.path);
    throw error;
  }
}

// 受限预览协议放行的本地格式：PDF 与三类 OOXML 交给 renderer 按 Range 拉取。
const streamedFormats = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

export function workspacePreviewPath(id: string): string {
  prepareStorage();
  const item = entry(workspaceEntryIdSchema.parse(id));
  if (item.kind !== 'file') throw new Error('文档不是可预览文件');
  const path = entryLocalPath(item);
  if (!streamedFormats.has(localFileFormat(path))) throw new Error('文档不是可预览文件');
  return path;
}

export async function workspaceFilePath(id: string): Promise<string> {
  prepareStorage();
  const item = entry(workspaceEntryIdSchema.parse(id));
  // 水源来源是实时引用，没有本地文件路径。
  if (item.kind === 'source' && item.sourceId?.startsWith('shuiyuan-topic:'))
    throw new Error('条目不是文件');
  if (item.kind === 'source' && item.sourceId) return canvasFilePath(item.sourceId);
  if (item.kind !== 'file') throw new Error('条目不是文件');
  const path = entryLocalPath(item);
  if (!statSync(path).isFile()) throw new Error('文件不存在');
  return path;
}

export async function readWorkspaceEntry(id: string): Promise<DocumentContent> {
  prepareStorage();
  const item = entry(id);
  if (item.kind === 'source' && item.sourceId) {
    if (item.sourceId.startsWith('shuiyuan-topic:')) {
      return readShuiyuanSource(Number(item.sourceId.slice('shuiyuan-topic:'.length)));
    }
    return readCanvasSource(item.sourceId);
  }
  if (item.kind !== 'file') throw new Error('请选择要打开的文档');
  const path = entryLocalPath(item);
  const format = localFileFormat(path);
  const stats = statSync(path);
  const version = `${stats.mtimeMs}-${stats.size}`;
  if (format === 'markdown' || format === 'text') {
    const read = readLocalText(path, format);
    if (read.kind === 'binary') return { title: item.name, format: 'binary', revision: version };
    return {
      title: item.name,
      format: read.format,
      text: read.text,
      readOnly: read.readOnly || undefined,
      truncated: read.truncated || undefined,
      // 只读片段没有可保存的版本；可编辑全文的 revision 是内容哈希，保存时据此判外部修改。
      revision: read.readOnly ? version : textRevision(read.text),
    };
  }
  if (format === 'binary') return { title: item.name, format, revision: version };
  if (streamedFormats.has(format)) {
    const previewUrl = `dela-resource://workspace/${encodeURIComponent(id)}?v=${version}`;
    if (format === 'pdf')
      return { title: item.name, format, previewUrl, mime: 'application/pdf', revision: version };
    const office = format as 'docx' | 'xlsx' | 'pptx';
    const link = office === 'pptx' ? readOfficeExportLink('workspace', id) : null;
    const exported = link ? officeExportPreviewInfo(link, version) : null;
    return {
      title: item.name,
      format,
      previewUrl,
      mime: officeZipMime[office],
      revision: version,
      office: exported ? { export: exported } : undefined,
    };
  }
  if (stats.size > IMAGE_READ_MAX_BYTES) throw new Error('图片较大，请在外部应用中打开');
  return {
    title: item.name,
    format,
    bytes: new Uint8Array(readFileSync(path)),
    mime: imageMimeOf(path),
    revision: version,
  };
}

export function saveWorkspaceNote(id: string, text: string, revision: string): string {
  prepareStorage();
  const item = entry(id);
  if (item.kind !== 'file') throw new Error('只有文本文件可以编辑');
  const path = entryLocalPath(item);
  const format = localFileFormat(path);
  if (format !== 'markdown' && format !== 'text') throw new Error('只有文本文件可以编辑');
  const next = writeLocalText(path, text, revision);
  if (!isAbsolute(id))
    getDatabase()
      .prepare('UPDATE workspace_entries SET updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id);
  return next;
}

export async function removeWorkspaceEntry(value: unknown): Promise<void> {
  const id = workspaceEntryIdSchema.parse(value);
  if (id === workspaceArchiveId) throw new Error('归档文件夹不能移除');
  const item = entry(id);
  if (item.kind === 'project') {
    // 「移除项目」即取消项目身份（同降格）：删除条目行，目录与文件保留，项目会话经外键转为通用。
    getDatabase().prepare('DELETE FROM workspace_entries WHERE id=?').run(item.id);
    return;
  }
  if (item.kind === 'source') {
    getDatabase().prepare('DELETE FROM workspace_entries WHERE id=?').run(id);
    return;
  }
  // 用户在应用中明确移除文件时才调用回收站；失败保留原文件，不退化为永久删除。
  await shell.trashItem(entryLocalPath(item));
}
