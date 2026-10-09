import { shell } from 'electron';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
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
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { z } from 'zod';
import { getDatabase } from '../database';
import { remoteById, targetOf } from '../remotes/api';
import { locate } from '../remotes/transport';
import { canvasFilePath, readCanvasSource } from '../canvas/api';
import { readShuiyuanSource } from '../shuiyuan/api';
import { toolError } from '../../shared/tool-errors';
import {
  availablePath,
  officeExportPreviewInfo,
  readOfficeExportLink,
  storageDirectory as directory,
} from '../storage';
import { officeZipMime } from '../resource-parse';
import { workspaceArchiveId } from '../../shared/api';
import { parseRemoteNodeId } from '../../shared/remotes';
import { workspaceEntryIdSchema, type WorkspaceEntryUpdate } from '../../shared/workspace';
import { textFileExtensions } from '../../shared/chat-input';
import { documentFormatOf } from '../../shared/documents';
import { isRelativeAssetPath, matchMarkdownImageRefs } from '../../shared/note-files';
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

// 笔记按扩展名区分为 Markdown 或普通文本；其余内容一律按文本读写。
const markdownExtensions = ['.md', '.markdown'];
// 本地/导入文件按 VSCode 对文本文件的宽泛处理内嵌展示；未列出的扩展仍不支持预览。
// 清单与助手 composer 附件共用（shared/chat-input.ts，无点小写）。
const textExtensions = new Set(textFileExtensions.map((extension) => `.${extension}`));

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

// 新插入图片的落盘白名单与大小上限（与助手内联图片的常规体积一致量级）。
const noteImageMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** 有可辨识扩展名（点后 1–8 位字母数字）才视为已带后缀；否则新建笔记补默认 .md。 */
function hasFileNameExtension(name: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(name);
}

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
  if (item.kind !== 'note' && item.kind !== 'local' && item.kind !== 'imported')
    throw new Error('此条目没有本地目录');
  const base = dirname(item.kind === 'note' ? notePath(item) : entryLocalPath(item));
  const path = join(base, ...ref.split('/'));
  const within = relative(base, path);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('资源路径超出文档目录');
  const mime = noteImageMime[extname(path).toLowerCase()];
  if (!mime) throw new Error('不支持的图片格式');
  if (!statSync(path).isFile()) throw new Error('图片文件不存在');
  return { path, mime };
}

/** 新插入的本地图片保存到笔记目录 assets/ 下，返回可写入 Markdown 的相对路径。 */
export function saveNoteImage(id: string, name: string, bytes: Uint8Array): string {
  prepareStorage();
  const item = entry(id);
  if (item.kind !== 'note') throw new Error('只有笔记可以插入图片');
  if (bytes.byteLength > NOTE_IMAGE_MAX_BYTES) throw new Error('图片超过 20MB，无法保存');
  if (!noteImageMime[extname(name).toLowerCase()]) throw new Error('不支持的图片格式');
  const noteDir = dirname(notePath(item));
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
    const source = join(fromDir, ...ref.path.split('/'));
    if (!existsSync(source) || !statSync(source).isFile()) continue;
    if (!inside(source)) continue; // 工作区外的引用不携带
    const target = join(toDir, ...ref.path.split('/'));
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

export async function openProjectDirectory(id: unknown, target: unknown): Promise<void> {
  const action = z.enum(['vscode', 'explorer']).parse(target);
  const path = projectDirectory(id);
  if (action === 'vscode') return openInVsCode(path);
  const error = await shell.openPath(path);
  if (error) throw new Error(`无法打开项目目录：${error}`);
}
async function openInVsCode(path: string): Promise<void> {
  const locate = () =>
    new Promise<string>((resolve, reject) => {
      execFile('where', ['code'], (error, stdout) => {
        const first = stdout.split(/\r?\n/).find((line) => line.trim());
        if (error || !first)
          reject(
            new Error(
              '未找到 VS Code 命令（code）。可先安装 VS Code，或在文件夹中显示后手动打开。',
            ),
          );
        else resolve(first.trim());
      });
    });
  const cli = await locate();
  // CLI 是批处理脚本；直接启动同安装目录的 Code.exe，路径不经 shell 展开。
  const executable = join(dirname(cli), '..', 'Code.exe');
  if (!existsSync(executable)) throw new Error('未找到 VS Code 程序，可改用资源管理器打开项目。');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [path], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', (error) => reject(new Error(`启动 VS Code 失败：${error.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
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
    if (existsSync(move.from) && existsSync(move.to)) finishMove(move);
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
  const extension = extname(path).toLowerCase();
  const text = textExtensions.has(extension) || !extension;
  return {
    id: stored?.id ?? path,
    parentId,
    name: basename(path),
    kind: stats.isDirectory() ? (stored?.kind ?? 'folder') : text ? 'note' : 'local',
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

export function createWorkspaceEntry(input: WorkspaceCreateInput): WorkspaceEntry {
  const parsed = z
    .object({
      parentId: workspaceEntryIdSchema.nullable(),
      name: nameSchema,
      kind: z.enum(['folder', 'project', 'note', 'source']),
      sourceId: z.string().max(512).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .parse(input);
  checkParent(parsed.parentId);
  prepareStorage();
  if (parsed.parentId && remoteProjectOf(parsed.parentId))
    throw new Error('远程项目内暂不支持新建笔记与文件夹');
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
  const id = randomUUID();
  const note = parsed.kind === 'note';
  let path: string | null = null;
  if (parsed.kind !== 'source') {
    // 新笔记默认 .md（所见即所得正文）；显式带其他扩展名时尊重用户选择。
    const name = note && !hasFileNameExtension(parsed.name) ? `${parsed.name}.md` : parsed.name;
    parsed.name = name;
    path = availablePath(containerPath(parsed.parentId), name, !note);
    if (note) writeFileSync(path, parsed.text ?? '', { flag: 'wx' });
    else mkdirSync(path);
  }
  if (parsed.kind === 'folder' || parsed.kind === 'note') return fileEntry(path!, parsed.parentId);
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
      // 笔记移动前快照正文，移动后按原相对路径携带图片；正文不改写，草稿 revision 不受影响。
      const noteText = current.kind === 'note' ? readFileSync(from, 'utf8') : null;
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

export function notePath(item: WorkspaceEntry): string {
  if (item.path) return item.path;
  throw new Error('笔记不存在');
}

// 受限预览协议放行的本地文件扩展名：PDF 与三类 OOXML。
const previewExtensions = new Set(['.pdf', '.docx', '.xlsx', '.pptx']);
const officeFormats: Record<string, 'docx' | 'xlsx' | 'pptx'> = {
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
};

/** 受限预览协议的解析入口：本地/导入条目按扩展名放行 PDF 与三类 OOXML。 */
export function workspacePreviewPath(id: string): string {
  prepareStorage();
  const item = entry(workspaceEntryIdSchema.parse(id));
  if (item.kind !== 'local' && item.kind !== 'imported') throw new Error('文档不是可预览文件');
  const path = entryLocalPath(item);
  if (!previewExtensions.has(extname(path).toLowerCase())) throw new Error('文档不是可预览文件');
  return path;
}

export async function workspaceFilePath(id: string): Promise<string> {
  prepareStorage();
  const item = entry(workspaceEntryIdSchema.parse(id));
  if (item.kind === 'note') return notePath(item);
  // 水源来源是实时引用，没有本地文件路径。
  if (item.kind === 'source' && item.sourceId?.startsWith('shuiyuan-topic:'))
    throw new Error('条目不是文件');
  if (item.kind === 'source' && item.sourceId) return canvasFilePath(item.sourceId);
  if (item.kind !== 'local' && item.kind !== 'imported') throw new Error('条目不是文件');
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
    const path = entryLocalPath(item);
    // 格式判定与远端文件共用（shared/documents）：远端没有宿主 extname，两边保持同一套规则。
    const format = documentFormatOf(path);
    const office = officeFormats[extname(path).toLowerCase()];
    if (format === 'unsupported') return { title: item.name, format };
    const stats = statSync(path);
    const version = `${stats.mtimeMs}-${stats.size}`;
    if (format === 'pdf')
      return {
        title: item.name,
        format,
        previewUrl: `dela-resource://workspace/${encodeURIComponent(id)}?v=${version}`,
        mime: 'application/pdf',
        revision: version,
      };
    if (office) {
      const link = office === 'pptx' ? readOfficeExportLink('workspace', id) : null;
      const exported = link ? officeExportPreviewInfo(link, version) : null;
      return {
        title: item.name,
        format,
        previewUrl: `dela-resource://workspace/${encodeURIComponent(id)}?v=${version}`,
        mime: officeZipMime[office],
        revision: version,
        office: exported ? { export: exported } : undefined,
      };
    }
    if (stats.size > 128 * 1024 * 1024) throw new Error('文件较大，请在外部应用中打开');
    const bytes = readFileSync(path);
    return {
      title: item.name,
      format,
      text: format === 'text' || format === 'markdown' ? bytes.toString('utf8') : undefined,
      revision: format === 'text' || format === 'markdown' ? hash(bytes.toString('utf8')) : version,
      bytes: format === 'text' ? undefined : new Uint8Array(bytes),
      mime:
        format === 'image'
          ? `image/${extname(path).toLowerCase() === '.jpg' ? 'jpeg' : extname(path).slice(1)}`
          : undefined,
    };
  }
  throw new Error('请选择要打开的文档');
}

export function saveWorkspaceNote(id: string, text: string, revision: string): string {
  prepareStorage();
  const item = entry(id);
  const path = entryLocalPath(item);
  if (item.kind !== 'note' && !textExtensions.has(extname(path).toLowerCase()) && extname(path))
    throw new Error('只有文本文件可以编辑');
  const disk = readFileSync(path, 'utf8');
  if (hash(disk) !== revision)
    throw new Error('笔记已在外部修改。你的草稿仍在，请另存为新笔记或重新载入后编辑。');
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  if (!isAbsolute(id))
    getDatabase()
      .prepare('UPDATE workspace_entries SET updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id);
  return hash(text);
}

export interface WorkspaceNoteEdit {
  oldText: string;
  newText: string;
}

export interface WorkspaceNoteEditApplied {
  /** 提交顺序（1 起）。 */
  index: number;
  /** 修改后正文中的行号（1 起）。 */
  line: number;
  /** 修改后正文中的字符偏移。 */
  start: number;
  removed: number;
  added: number;
  /** 新文本前 160 字符预览。 */
  preview: string;
}

/** 局部修改结果：新 revision 与每处修改的定位摘要。 */
export interface WorkspaceNoteEditResult {
  revision: string;
  applied: WorkspaceNoteEditApplied[];
}

/**
 * 基于明确版本的笔记局部修改：每处 oldText 必须在正文中唯一匹配，多处修改区间不重叠，
 * base revision 不匹配报 VERSION_CONFLICT。任何校验失败不落盘；成功原子写并记录版本。
 */
export function editWorkspaceNote(
  id: string,
  edits: WorkspaceNoteEdit[],
  revision: string,
): WorkspaceNoteEditResult {
  prepareStorage();
  let item: WorkspaceEntry;
  try {
    item = entry(id);
  } catch {
    throw toolError('NOT_FOUND', '条目不存在');
  }
  if (item.kind !== 'note') throw toolError('OPERATION_FAILED', '只有笔记可以编辑');
  const path = notePath(item);
  const disk = readFileSync(path, 'utf8');
  if (hash(disk) !== revision)
    throw toolError('VERSION_CONFLICT', '笔记已在外部修改，请重新读取最新内容后再提交修改。');
  const located: Array<{
    index: number;
    start: number;
    end: number;
    newText: string;
    newStart: number;
  }> = edits.map((edit, index) => {
    const first = disk.indexOf(edit.oldText);
    if (first < 0)
      throw toolError('OPERATION_FAILED', `第 ${index + 1} 处修改：原文在笔记中不存在`);
    if (disk.indexOf(edit.oldText, first + 1) >= 0)
      throw toolError(
        'OPERATION_FAILED',
        `第 ${index + 1} 处修改：原文出现多次，无法唯一定位，请扩大原文范围`,
      );
    return {
      index,
      start: first,
      end: first + edit.oldText.length,
      newText: edit.newText,
      newStart: first,
    };
  });
  const ordered = [...located].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1)
    if (ordered[index]!.start < ordered[index - 1]!.end)
      throw toolError(
        'OPERATION_FAILED',
        `第 ${ordered[index - 1]!.index + 1} 处与第 ${ordered[index]!.index + 1} 处修改区间重叠`,
      );
  // 从后往前替换，避免前面的修改移动后面的区间。
  let text = disk;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const edit = ordered[index]!;
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
  }
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  const nextRevision = hash(text);
  if (!isAbsolute(id))
    getDatabase()
      .prepare('UPDATE workspace_entries SET updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id);
  // 按提交顺序返回定位；start/line 换算到修改后正文坐标（前面的修改会平移后面的区间）。
  let delta = 0;
  for (const edit of ordered) {
    edit.newStart = edit.start + delta;
    delta += edit.newText.length - (edit.end - edit.start);
  }
  return {
    revision: nextRevision,
    applied: located.map((edit) => ({
      index: edit.index + 1,
      line: text.slice(0, edit.newStart).split('\n').length,
      start: edit.newStart,
      removed: edit.end - edit.start,
      added: edit.newText.length,
      preview: edit.newText.length > 160 ? `${edit.newText.slice(0, 160)}…` : edit.newText,
    })),
  };
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
