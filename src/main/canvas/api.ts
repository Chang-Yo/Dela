import { copyFile, link, lstat, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { getDatabase } from '../database';
import { availablePath, diskName, storageDirectory } from '../storage';
import { compareCanvasTerms, latestTermOf } from '../../shared/canvas';
import type {
  CachedCourseFile,
  CanvasCacheClearResult,
  CanvasCachePinScope,
  CanvasCachePins,
  CanvasCachePolicy,
  CanvasCacheScope,
  CanvasCacheStats,
  CanvasExportResult,
} from '../../shared/canvas';
import { selectCanvasCacheEntries } from './cache-policy';
import { pickCourseFiles, collectCourseFileEntries } from './course-files';
import { officeExportPreviewInfo, readOfficeExportLink } from '../documents/links';
import { classifyOfficeFile, officeZipMime } from '../documents/parse';
import { loadCanvasToken, saveCanvasToken } from '../credentials';
import type { CanvasCourse, CanvasState, DocumentContent, SourceItem } from '../../shared/api';

const origin = 'https://oc.sjtu.edu.cn';
const apiRoot = `${origin}/api/v1/`;
type Row = Record<string, unknown>;
const rowSchema = z.record(z.string(), z.unknown());
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const row = (value: unknown): Row => rowSchema.safeParse(value).data ?? {};

export function canvasNextPage(header: string | null): string | null {
  const next = header
    ?.split(',')
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/)?.[1];
  if (!next) return null;
  const url = new URL(next, apiRoot);
  if (url.origin !== origin || !url.pathname.startsWith('/api/v1/'))
    throw new Error('Canvas 分页地址无效');
  return url.href;
}

async function request(path: string, token = loadCanvasToken()): Promise<Response> {
  if (!token) throw new Error('请先连接 Canvas');
  const url = new URL(path, apiRoot);
  if (
    url.origin !== origin ||
    !(url.pathname.startsWith('/api/v1/') || url.pathname === '/login/session_token')
  )
    throw new Error('Canvas 地址无效');
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('无法连接 Canvas，请检查网络后重试');
  }
  if (!response.ok)
    throw new Error(
      `Canvas HTTP ${response.status}${response.status === 401 ? '：令牌失效或无权访问此内容' : response.status === 404 ? '：内容不可用' : ''}`,
    );
  return response;
}

async function list(path: string): Promise<Row[]> {
  let next: string | null = new URL(path, apiRoot).href;
  const visited = new Set<string>();
  const result: Row[] = [];
  while (next) {
    if (visited.has(next)) throw new Error('Canvas 返回了重复分页');
    visited.add(next);
    const response = await request(next);
    result.push(...z.array(rowSchema).parse(await response.json()));
    next = canvasNextPage(response.headers.get('link'));
  }
  return result;
}

export function getCanvasState(): CanvasState {
  const rows = getDatabase().prepare('SELECT data, items FROM canvas_courses').all() as {
    data: string;
    items: string;
  }[];
  const synced = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key = 'canvas-sync'")
    .get() as { value: string } | undefined;
  return {
    connected: Boolean(loadCanvasToken()),
    syncedAt: synced?.value ?? null,
    courses: rows.map((r) => JSON.parse(r.data)),
    items: rows.flatMap((r) => JSON.parse(r.items)),
  };
}

export async function configureCanvas(token: string) {
  await request('users/self/profile', z.string().trim().min(1).max(4096).parse(token));
  saveCanvasToken(token.trim());
}

/** 交大视频不接受 Canvas 令牌：换取直达「课堂视频」LTI 入口的一次性网页登录地址，地址本身即凭据。 */
export async function classroomLoginUrl(): Promise<string> {
  for (const course of await list('courses?enrollment_state=active&per_page=100')) {
    const tab = (await list(`courses/${num(course.id)}/tabs`)).find(
      (tab) => str(tab.label).includes('课堂视频') && !str(tab.label).includes('旧版'),
    );
    if (!tab) continue;
    const tool = new URL(str(tab.html_url), origin);
    if (tool.origin !== origin) continue;
    const response = await request(
      `/login/session_token?${new URLSearchParams({ return_to: tool.href })}`,
    );
    const login = new URL(
      z.object({ session_url: z.string() }).parse(await response.json()).session_url,
    );
    if (login.origin !== origin) throw new Error('Canvas 登录地址无效');
    return login.href;
  }
  throw new Error('Canvas 课程中没有找到课堂视频入口');
}

export async function syncCanvasCourses(): Promise<CanvasState> {
  const courses = await list('courses?include[]=term&per_page=50');
  const db = getDatabase();
  const old = new Map(getCanvasState().courses.map((c) => [c.id, c]));
  db.transaction(() => {
    const insert = db.prepare(
      'INSERT INTO canvas_courses(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    );
    for (const course of courses) {
      const id = num(course.id);
      if (!id) continue;
      const previous = old.get(id);
      const data: CanvasCourse = {
        id,
        name: str(course.name) || str(course.course_code) || `课程 ${id}`,
        term: str(row(course.term).name) || '未标注学期',
        code: str(course.course_code),
        syncedAt: previous?.syncedAt ?? null,
        error: previous?.error ?? null,
        archived: previous?.archived ?? false,
      };
      insert.run(id, JSON.stringify(data));
    }
    // Retain inaccessible historical courses and project references; never turn a failed sync into deletion.
    db.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('canvas-sync', ?)").run(
      new Date().toISOString(),
    );
  })();
  return getCanvasState();
}

export interface StoredSource {
  id: string;
  courseId: number;
  title: string;
  kind: 'file' | 'assignment' | 'page' | 'discussion' | 'link';
  html?: string;
  url?: string;
  fileId?: number;
  mime?: string;
  size?: number;
  dueAt?: string | null;
  updatedAt?: string | null;
  pageUrl?: string;
}

const syncing = new Map<number, Promise<CanvasState>>();
export function syncCanvasCourse(id: number): Promise<CanvasState> {
  const existing = syncing.get(id);
  if (existing) return existing;
  const work = syncCourse(id).finally(() => syncing.delete(id));
  syncing.set(id, work);
  return work;
}

async function syncCourse(id: number): Promise<CanvasState> {
  const course = getCanvasState().courses.find((c) => c.id === id);
  if (!course) throw new Error('课程不存在，请刷新课程列表');
  const items: SourceItem[] = [];
  const sources = new Map<string, StoredSource>();
  const errors: string[] = [];
  const oldItems = getCanvasState().items.filter((i) => i.courseId === id);
  const group = (key: string, name: string) => {
    const groupId = `${id}:${key}`;
    items.push({ id: groupId, parentId: null, courseId: id, name, kind: 'folder', sourceId: null });
    return groupId;
  };
  const file = (f: Row, parentId: string) => {
    const fileId = num(f.id);
    if (!fileId) return;
    const sourceId = `file:${fileId}`;
    const name = str(f.display_name) || str(f.filename) || `文件 ${fileId}`;
    sources.set(sourceId, {
      id: sourceId,
      courseId: id,
      title: name,
      kind: 'file',
      fileId,
      mime: str(f['content-type']),
      size: num(f.size),
      updatedAt: str(f.updated_at) || null,
    });
    items.push({
      id: `${parentId}/${sourceId}`,
      parentId,
      courseId: id,
      name,
      kind: 'file',
      sourceId,
    });
  };
  const branch = async (key: string, name: string, build: () => Promise<void>) => {
    const start = items.length;
    try {
      await build();
    } catch (error) {
      items.splice(start);
      const rootId = `${id}:${key}`;
      const keep = new Set([rootId]);
      for (let changed = true; changed;) {
        changed = false;
        for (const item of oldItems)
          if (item.parentId && keep.has(item.parentId) && !keep.has(item.id)) {
            keep.add(item.id);
            changed = true;
          }
      }
      items.push(...oldItems.filter((item) => keep.has(item.id)));
      errors.push(`${name}：${error instanceof Error ? error.message : '同步失败'}`);
    }
  };
  // Each branch commits its own successful snapshot; unavailable tabs leave their old cache intact.
  await branch('files', '文件', async () => {
    const [folders, files] = await Promise.all([
      list(`courses/${id}/folders?per_page=50`),
      list(`courses/${id}/files?per_page=50`),
    ]);
    const rootId = group('files', '文件');
    const roots = new Set(folders.filter((f) => f.parent_folder_id === null).map((f) => num(f.id)));
    const known = new Set(folders.map((f) => num(f.id)));
    for (const f of folders) {
      const fid = num(f.id);
      if (!fid || roots.has(fid)) continue;
      items.push({
        id: `folder:${fid}`,
        parentId:
          roots.has(num(f.parent_folder_id)) || !known.has(num(f.parent_folder_id))
            ? rootId
            : `folder:${num(f.parent_folder_id)}`,
        courseId: id,
        name: str(f.name),
        kind: 'folder',
        sourceId: null,
      });
    }
    for (const f of files)
      file(
        f,
        roots.has(num(f.folder_id)) || !known.has(num(f.folder_id))
          ? rootId
          : `folder:${num(f.folder_id)}`,
      );
  });
  await branch('assignments', '作业', async () => {
    const rows = await list(`courses/${id}/assignments?include[]=submission&per_page=50`);
    if (!rows.length) return;
    const rootId = group('assignments', '作业');
    for (const a of rows) {
      const sourceId = `assignment:${num(a.id)}`;
      const title = str(a.name);
      const dueAt = str(a.due_at) || null;
      sources.set(sourceId, {
        id: sourceId,
        courseId: id,
        title,
        kind: 'assignment',
        html: str(a.description),
        dueAt,
        url: str(a.html_url),
        updatedAt: str(a.updated_at) || null,
      });
      items.push({
        id: sourceId,
        parentId: rootId,
        courseId: id,
        name: title,
        kind: 'assignment',
        sourceId,
        dueAt,
      });
      const attachments = row(a.submission).attachments;
      if (Array.isArray(attachments) && attachments.length) {
        const submissionId = `${sourceId}:submission`;
        items.push({
          id: submissionId,
          parentId: sourceId,
          courseId: id,
          name: '我的提交',
          kind: 'folder',
          sourceId: null,
        });
        for (const attachment of attachments) file(row(attachment), submissionId);
      }
    }
  });
  await branch('discussions', '通知与讨论', async () => {
    const rows = await list(`courses/${id}/discussion_topics?per_page=50`);
    if (!rows.length) return;
    const rootId = group('discussions', '通知与讨论');
    for (const d of rows) {
      const sourceId = `discussion:${id}:${num(d.id)}`;
      sources.set(sourceId, {
        id: sourceId,
        courseId: id,
        title: str(d.title),
        kind: 'discussion',
        html: str(d.message),
        url: str(d.html_url),
        updatedAt: str(d.last_reply_at) || null,
      });
      items.push({
        id: sourceId,
        parentId: rootId,
        courseId: id,
        name: str(d.title),
        kind: 'discussion',
        sourceId,
      });
    }
  });
  await branch('modules', '课程模块', async () => {
    const modules = await list(`courses/${id}/modules?per_page=50`);
    if (!modules.length) return;
    const rootId = group('modules', '课程模块');
    for (const m of modules) {
      const moduleId = `module:${num(m.id)}`;
      items.push({
        id: moduleId,
        parentId: rootId,
        courseId: id,
        name: str(m.name),
        kind: 'module',
        sourceId: null,
      });
      for (const i of await list(`courses/${id}/modules/${num(m.id)}/items?per_page=50`)) {
        const nodeId = `module-item:${num(i.id)}`;
        const type = str(i.type);
        let sourceId: string | null =
          type === 'File'
            ? `file:${num(i.content_id)}`
            : type === 'Assignment'
              ? `assignment:${num(i.content_id)}`
              : type === 'Discussion'
                ? `discussion:${id}:${num(i.content_id)}`
                : type === 'Page'
                  ? `page:${id}:${str(i.page_url)}`
                  : type === 'SubHeader'
                    ? null
                    : nodeId;
        const kind: SourceItem['kind'] =
          type === 'File'
            ? 'file'
            : type === 'Assignment'
              ? 'assignment'
              : type === 'Discussion'
                ? 'discussion'
                : type === 'Page'
                  ? 'page'
                  : sourceId
                    ? 'link'
                    : 'folder';
        if (
          sourceId &&
          !sources.has(sourceId) &&
          !getDatabase().prepare('SELECT 1 FROM canvas_sources WHERE id=?').get(sourceId)
        )
          sources.set(sourceId, {
            id: sourceId,
            courseId: id,
            title: str(i.title),
            kind: kind as StoredSource['kind'],
            fileId: type === 'File' ? num(i.content_id) : undefined,
            pageUrl: type === 'Page' ? str(i.page_url) : undefined,
            url: str(i.external_url) || str(i.html_url),
          });
        items.push({
          id: nodeId,
          parentId: moduleId,
          courseId: id,
          name: str(i.title),
          kind,
          sourceId,
        });
      }
    }
  });
  const db = getDatabase();
  course.syncedAt = new Date().toISOString();
  course.error = errors.length ? errors.join('\n') : null;
  db.transaction(() => {
    db.prepare('UPDATE canvas_courses SET data=?, items=? WHERE id=?').run(
      JSON.stringify(course),
      JSON.stringify(items),
      id,
    );
    const insert = db.prepare('INSERT OR REPLACE INTO canvas_sources VALUES (?, ?, ?)');
    for (const source of sources.values()) insert.run(source.id, id, JSON.stringify(source));
  })();
  return getCanvasState();
}

// 后台目录同步与手动刷新同一口径：最新学期 + 未归档；顺序执行避免并发轰炸 Canvas。
export async function syncCanvasCourseTrees(): Promise<CanvasState> {
  const state = await syncCanvasCourses();
  const latest = latestTermOf(state.courses);
  for (const course of state.courses)
    if (course.term === latest && !course.archived) await syncCanvasCourse(course.id);
  return getCanvasState();
}

/** 归档后不参与自动同步，仅保留本地已同步数据。 */
export function archiveCanvasCourse(id: number, archived: boolean): CanvasState {
  const db = getDatabase();
  const rowById = db.prepare('SELECT data FROM canvas_courses WHERE id=?').get(id) as
    { data: string } | undefined;
  if (!rowById) throw new Error('课程不存在，请刷新课程列表');
  const course: CanvasCourse = { ...JSON.parse(rowById.data), archived };
  db.prepare('UPDATE canvas_courses SET data=? WHERE id=?').run(JSON.stringify(course), id);
  return getCanvasState();
}

export function getSource(id: string): StoredSource {
  const stored = getDatabase().prepare('SELECT data FROM canvas_sources WHERE id=?').get(id) as
    { data: string } | undefined;
  if (!stored) throw new Error('资料尚未同步，请刷新所属课程');
  return JSON.parse(stored.data);
}

const downloads = new Map<string, Promise<{ path: string; mime: string }>>();
const CACHE_POLICY_KEY = 'canvas-cache-policy';
const CACHE_LAST_CLEANUP_KEY = 'canvas-cache-last-cleanup';
const DEFAULT_CACHE_POLICY: CanvasCachePolicy = {
  enabled: false,
  maxBytes: 5 * 1024 ** 3,
  keepCurrentTerm: false,
};
let cleanupTask: Promise<CanvasCacheCleanupResult> | null = null;

interface CanvasCacheCleanupResult {
  removedFiles: number;
  freedBytes: number;
  blockedFiles: number;
}

function canvasCachePolicy(): CanvasCachePolicy {
  const value = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(CACHE_POLICY_KEY) as { value: string } | undefined;
  if (!value) return DEFAULT_CACHE_POLICY;
  try {
    const parsed = JSON.parse(value.value) as Partial<CanvasCachePolicy>;
    if (
      typeof parsed.enabled !== 'boolean' ||
      typeof parsed.maxBytes !== 'number' ||
      !Number.isFinite(parsed.maxBytes) ||
      parsed.maxBytes < 100 * 1024 ** 2 ||
      typeof parsed.keepCurrentTerm !== 'boolean'
    )
      return DEFAULT_CACHE_POLICY;
    return {
      enabled: parsed.enabled,
      maxBytes: Math.round(parsed.maxBytes),
      keepCurrentTerm: parsed.keepCurrentTerm,
    };
  } catch {
    return DEFAULT_CACHE_POLICY;
  }
}

function canvasCachePins(): CanvasCachePins {
  const rows = getDatabase().prepare('SELECT kind, item_id FROM canvas_cache_pins').all() as {
    kind: 'file' | 'course';
    item_id: number;
  }[];
  return {
    fileIds: rows.filter((row) => row.kind === 'file').map((row) => row.item_id),
    courseIds: rows.filter((row) => row.kind === 'course').map((row) => row.item_id),
  };
}

function touchCanvasCache(source: StoredSource) {
  if (!source.fileId) return;
  getDatabase()
    .prepare(
      `INSERT INTO canvas_cache_usage(cache_key, file_id, last_used_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET file_id=excluded.file_id, last_used_at=excluded.last_used_at`,
    )
    .run(canvasFileCacheKey(source), source.fileId, Date.now());
}

function lastCanvasCacheCleanup(): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(CACHE_LAST_CLEANUP_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function canvasFileCacheKey(source: Pick<StoredSource, 'fileId' | 'updatedAt'>) {
  return `canvas-file:${createHash('sha256')
    .update(`${source.fileId}:${source.updatedAt ?? ''}`)
    .digest('hex')}`;
}

export function cachedFile(source: StoredSource): Promise<{ path: string; mime: string }> {
  const key = `${source.id}:${source.updatedAt ?? ''}`;
  const existing = downloads.get(key);
  if (existing) return existing;
  const work = downloadFile(source)
    .then((file) => {
      touchCanvasCache(source);
      void runCanvasCacheCleanup().catch((error: unknown) =>
        console.error('Canvas cache cleanup failed', error),
      );
      return file;
    })
    .finally(() => downloads.delete(key));
  downloads.set(key, work);
  return work;
}

function courseTermDirectory(term: string | undefined) {
  const value = term ?? '';
  const year = value.match(/(?:19|20)\d{2}/)?.[0];
  const season = /春|spring/i.test(value)
    ? 'spring'
    : /夏|summer/i.test(value)
      ? 'summer'
      : /秋|fall|autumn/i.test(value)
        ? 'fall'
        : /冬|winter/i.test(value)
          ? 'winter'
          : undefined;
  if (year) return `term-${year}${season ? `-${season}` : ''}`;
  return value
    ? `term-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
    : 'term-unspecified';
}

function sourceDirectory(source: StoredSource): string {
  const state = getCanvasState();
  const course = state.courses.find((item) => item.id === source.courseId);
  const items = state.items.filter((item) => item.courseId === source.courseId);
  // Prefer the original file tree over module references to the same source.
  const original = items.find(
    (item) => item.sourceId === source.id && !item.id.startsWith('module-item:'),
  );
  const folders: string[] = [];
  const seen = new Set<string>();
  let parentId = original?.parentId;
  while (parentId) {
    if (seen.has(parentId)) throw new Error('课程文件目录包含循环');
    seen.add(parentId);
    const parent = items.find((item) => item.id === parentId);
    if (!parent) break;
    if (parent.id === `${source.courseId}:files`) folders.unshift('files');
    else if (parent.id === `${source.courseId}:assignments`) folders.unshift('assignments');
    else if (parent.id === `${source.id}:submission`) folders.unshift('submission');
    else if (parent.id.startsWith('assignment:'))
      folders.unshift(`assignment-${parent.id.slice(11)}`);
    else if (parent.id.startsWith('folder:')) folders.unshift(`folder-${parent.id.slice(7)}`);
    else
      folders.unshift(
        `source-${createHash('sha256').update(parent.id).digest('hex').slice(0, 12)}`,
      );
    parentId = parent.parentId;
  }
  return join(
    storageDirectory(),
    'courses',
    courseTermDirectory(course?.term),
    diskName(`${course?.name || `course-${source.courseId}`} [${source.courseId}]`),
    ...folders,
  );
}

async function downloadFile(source: StoredSource): Promise<{ path: string; mime: string }> {
  if (!source.fileId) throw new Error('文件不可用');
  const db = getDatabase();
  const cacheKey = canvasFileCacheKey(source);
  const cached = db.prepare('SELECT value FROM workspace_settings WHERE key=?').get(cacheKey) as
    { value: string } | undefined;
  const dir = sourceDirectory(source);
  if (cached && existsSync(cached.value)) {
    // availablePath treats our own cached file as a collision. Reusing a file
    // must not rename it underneath another active PDF range request.
    if (resolve(dirname(cached.value)) === resolve(dir))
      return { path: cached.value, mime: source.mime || 'application/octet-stream' };
    mkdirSync(dir, { recursive: true });
    const path = availablePath(dir, source.title);
    if (path !== cached.value) {
      await rename(cached.value, path);
      db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(cacheKey, path);
      return { path, mime: source.mime || 'application/octet-stream' };
    }
    return { path: cached.value, mime: source.mime || 'application/octet-stream' };
  }
  mkdirSync(dir, { recursive: true });
  const metadata = row(await (await request(`files/${source.fileId}`)).json());
  const downloadUrl = new URL(str(metadata.url), origin);
  if (downloadUrl.origin !== origin) throw new Error('Canvas 下载地址无效');
  const first = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${loadCanvasToken()}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  let response = first;
  if (first.status >= 300 && first.status < 400) {
    const target = new URL(first.headers.get('location') || '', origin);
    if (
      target.protocol !== 'https:' ||
      ![new URL(origin).hostname, 's3.jcloud.sjtu.edu.cn'].includes(target.hostname)
    )
      throw new Error('Canvas 下载重定向无效');
    // Signed storage URL is a credential: never expose it or forward the Canvas Authorization header.
    response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  }
  if (!response.ok) throw new Error(`文件下载失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error('文件下载没有返回内容');
  const path = availablePath(dir, source.title);
  const temporary = `${path}.${randomUUID()}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    if (num(metadata.size) && (await stat(temporary)).size !== num(metadata.size))
      throw new Error('文件下载不完整，请重试');
    try {
      await link(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(code ?? '')) throw error;
      await copyFile(temporary, path, constants.COPYFILE_EXCL);
    }
    await rm(temporary);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(cacheKey, path);
  source.mime = str(metadata['content-type']) || 'application/octet-stream';
  db.prepare('UPDATE canvas_sources SET data=? WHERE id=?').run(JSON.stringify(source), source.id);
  return { path, mime: source.mime };
}

interface CanvasCacheEntry {
  key: string;
  path: string;
  bytes: number;
  term: string;
  courseId: number | null;
  courseName: string;
  fileId: number | null;
  lastUsedAt: number;
  pinned: boolean;
  coursePinned: boolean;
}

export function canvasCacheDirectory() {
  return join(storageDirectory(), 'courses');
}

function cachedPathInfo(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const index = parts.lastIndexOf('courses');
  if (index < 0) return { term: '未归类缓存', courseId: null, courseName: '其他缓存' };
  const term = parts[index + 1];
  const courseDirectory = parts[index + 2];
  if (!term || !courseDirectory)
    return { term: '未归类缓存', courseId: null, courseName: '其他缓存' };
  const match = /^(.*) \[(\d+)\]$/.exec(courseDirectory);
  return {
    term,
    courseId: match ? Number(match[2]) : null,
    courseName: match?.[1] || courseDirectory,
  };
}

async function canvasCacheEntries(): Promise<CanvasCacheEntry[]> {
  const db = getDatabase();
  const state = getCanvasState();
  const courses = new Map(state.courses.map((course) => [course.id, course]));
  const usage = new Map(
    (
      db.prepare('SELECT cache_key, file_id, last_used_at FROM canvas_cache_usage').all() as {
        cache_key: string;
        file_id: number;
        last_used_at: number;
      }[]
    ).map((row) => [row.cache_key, row]),
  );
  const pins = canvasCachePins();
  const sourceRows = db.prepare('SELECT data FROM canvas_sources').all() as { data: string }[];
  const sources = new Map<
    string,
    { term: string; courseId: number; courseName: string; fileId: number }
  >();
  for (const row of sourceRows) {
    const source = JSON.parse(row.data) as StoredSource;
    if (source.kind !== 'file' || !source.fileId) continue;
    const course = courses.get(source.courseId);
    if (!course) continue;
    sources.set(canvasFileCacheKey(source), {
      term: course.term,
      courseId: course.id,
      courseName: course.name,
      fileId: source.fileId,
    });
  }
  const rows = db
    .prepare("SELECT key, value FROM workspace_settings WHERE key LIKE 'canvas-file:%'")
    .all() as { key: string; value: string }[];
  const entries: CanvasCacheEntry[] = [];
  for (const row of rows) {
    const current = sources.get(row.key) ?? cachedPathInfo(row.value);
    let bytes = 0;
    try {
      const info = await lstat(row.value);
      if (!info.isFile()) continue;
      bytes = info.size;
    } catch {
      continue;
    }
    const usageRow = usage.get(row.key);
    const fileId =
      ('fileId' in current && typeof current.fileId === 'number'
        ? current.fileId
        : usageRow?.file_id) ?? null;
    const courseId = typeof current.courseId === 'number' ? current.courseId : null;
    const coursePinned = courseId !== null && pins.courseIds.includes(courseId);
    const filePinned = fileId !== null && pins.fileIds.includes(fileId);
    let lastUsedAt = usageRow?.last_used_at ?? 0;
    if (!lastUsedAt) {
      try {
        lastUsedAt = (await lstat(row.value)).mtimeMs;
      } catch {
        lastUsedAt = 0;
      }
    }
    entries.push({
      key: row.key,
      path: row.value,
      bytes,
      ...current,
      fileId,
      lastUsedAt,
      pinned: filePinned || coursePinned,
      coursePinned,
    });
  }
  return entries;
}

export async function canvasCacheStats(): Promise<CanvasCacheStats> {
  const entries = await canvasCacheEntries();
  const terms = new Map<string, CanvasCacheEntry[]>();
  for (const entry of entries) {
    const list = terms.get(entry.term);
    if (list) list.push(entry);
    else terms.set(entry.term, [entry]);
  }
  return {
    directory: canvasCacheDirectory(),
    fileCount: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    terms: [...terms.entries()]
      .sort(([a], [b]) => compareCanvasTerms(a, b) || a.localeCompare(b))
      .map(([term, termEntries]) => {
        const courses = new Map<string, CanvasCacheEntry[]>();
        for (const entry of termEntries) {
          const key = `${entry.courseId ?? ''}:${entry.courseName}`;
          const list = courses.get(key);
          if (list) list.push(entry);
          else courses.set(key, [entry]);
        }
        const groups = [...courses.values()]
          .sort((a, b) => a[0]!.courseName.localeCompare(b[0]!.courseName))
          .map((courseEntries) => ({
            id: courseEntries[0]!.courseId,
            name: courseEntries[0]!.courseName,
            fileCount: courseEntries.length,
            bytes: courseEntries.reduce((total, entry) => total + entry.bytes, 0),
            pinned: courseEntries.some((entry) => entry.coursePinned),
          }));
        return {
          term,
          fileCount: termEntries.length,
          bytes: termEntries.reduce((total, entry) => total + entry.bytes, 0),
          courses: groups,
        };
      }),
    policy: canvasCachePolicy(),
    lastCleanupAt: lastCanvasCacheCleanup(),
  };
}

export function getCanvasCachePins(): CanvasCachePins {
  return canvasCachePins();
}

export async function updateCanvasCachePolicy(
  policy: CanvasCachePolicy,
): Promise<CanvasCacheStats> {
  const value: CanvasCachePolicy = {
    enabled: z.boolean().parse(policy.enabled),
    maxBytes: Math.round(
      z
        .number()
        .finite()
        .min(100 * 1024 ** 2)
        .parse(policy.maxBytes),
    ),
    keepCurrentTerm: z.boolean().parse(policy.keepCurrentTerm),
  };
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(CACHE_POLICY_KEY, JSON.stringify(value));
  await runCanvasCacheCleanup();
  return canvasCacheStats();
}

export async function setCanvasCachePin(
  scope: CanvasCachePinScope,
  pinned: boolean,
): Promise<CanvasCachePins> {
  const itemId = scope.kind === 'file' ? scope.fileId : scope.courseId;
  if (typeof itemId !== 'number' || !Number.isInteger(itemId) || itemId <= 0)
    throw new Error('缓存固定对象无效');
  const db = getDatabase();
  if (pinned)
    db.prepare('INSERT OR IGNORE INTO canvas_cache_pins(kind, item_id) VALUES (?, ?)').run(
      scope.kind,
      itemId,
    );
  else
    db.prepare('DELETE FROM canvas_cache_pins WHERE kind=? AND item_id=?').run(scope.kind, itemId);
  if (!pinned) await runCanvasCacheCleanup();
  return canvasCachePins();
}

export async function runCanvasCacheCleanup(): Promise<CanvasCacheCleanupResult> {
  if (cleanupTask) return cleanupTask;
  cleanupTask = (async () => {
    const policy = canvasCachePolicy();
    if (!policy.enabled) return { removedFiles: 0, freedBytes: 0, blockedFiles: 0 };
    const entries = await canvasCacheEntries();
    const selected = selectCanvasCacheEntries(
      entries,
      policy,
      latestTermOf(getCanvasState().courses),
    );
    const db = getDatabase();
    let removedFiles = 0;
    let freedBytes = 0;
    let blockedFiles = 0;
    for (const entry of selected) {
      try {
        await rm(entry.path);
        db.prepare('DELETE FROM workspace_settings WHERE key=?').run(entry.key);
        db.prepare('DELETE FROM canvas_cache_usage WHERE cache_key=?').run(entry.key);
        removedFiles++;
        freedBytes += entry.bytes;
      } catch {
        blockedFiles++;
      }
    }
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      CACHE_LAST_CLEANUP_KEY,
      new Date().toISOString(),
    );
    return { removedFiles, freedBytes, blockedFiles };
  })().finally(() => {
    cleanupTask = null;
  });
  return cleanupTask;
}

export async function clearCanvasCache(scope: CanvasCacheScope): Promise<CanvasCacheClearResult> {
  const db = getDatabase();
  const entries = await canvasCacheEntries();
  const selected = entries.filter((entry) => {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'term') return entry.term === scope.term;
    return entry.courseId === scope.courseId;
  });
  let removedFiles = 0;
  let freedBytes = 0;
  let blockedFiles = 0;
  for (const entry of selected) {
    try {
      await rm(entry.path, { force: true });
      db.prepare('DELETE FROM workspace_settings WHERE key=?').run(entry.key);
      db.prepare('DELETE FROM canvas_cache_usage WHERE cache_key=?').run(entry.key);
      removedFiles++;
      freedBytes += entry.bytes;
    } catch {
      blockedFiles++;
    }
  }
  return { removedFiles, freedBytes, blockedFiles };
}

async function isPdf(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString() === '%PDF-';
  } finally {
    await file.close();
  }
}

export async function canvasFilePath(id: string): Promise<string> {
  const source = getSource(z.string().min(1).max(512).parse(id));
  if (source.kind !== 'file') throw new Error('资料不是文件');
  return (await cachedFile(source)).path;
}

/** 受限预览协议的解析入口：返回 Canvas 文件的缓存路径，只放行 PDF 与可识别的 OOXML。 */
export async function canvasPreviewPath(id: string): Promise<string> {
  const source = getSource(z.string().max(512).parse(id));
  if (source.kind !== 'file') throw new Error('资料不是可预览文件');
  const cached = await cachedFile(source);
  if ((await isPdf(cached.path)) || (await classifyOfficeFile(cached.path))) return cached.path;
  throw new Error('资料不是可预览文件');
}

export async function readCanvasSource(id: string): Promise<DocumentContent> {
  const source = getSource(id);
  if (source.kind === 'file') {
    const cached = await cachedFile(source);
    const pdf = await isPdf(cached.path);
    const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(cached.mime);
    const office = pdf || image ? null : await classifyOfficeFile(cached.path);
    const link = office === 'pptx' ? readOfficeExportLink('canvas', id) : null;
    const exported = link ? officeExportPreviewInfo(link, source.updatedAt ?? '') : null;
    const bytes = image ? new Uint8Array(await readFile(cached.path)) : undefined;
    return {
      title: source.title,
      format: pdf ? 'pdf' : image ? 'image' : (office ?? 'binary'),
      bytes,
      previewUrl:
        pdf || office
          ? `dela-resource://canvas/${encodeURIComponent(id)}?v=${encodeURIComponent(source.updatedAt ?? '')}`
          : undefined,
      mime: pdf ? 'application/pdf' : office ? officeZipMime[office] : cached.mime,
      office: exported ? { export: exported } : undefined,
      updatedAt: source.updatedAt,
    };
  }
  return readCanvasPage(id);
}

/** 页面正文供 GUI 与资源读取共用，不经过文件预览。 */
export async function readCanvasPage(id: string) {
  const source = getSource(id);
  if (source.kind === 'file') throw new Error('资料不是页面');
  if (
    source.html === undefined &&
    (source.kind === 'page' || source.kind === 'assignment' || source.kind === 'discussion')
  ) {
    const path =
      source.kind === 'page'
        ? `pages/${encodeURIComponent(source.pageUrl ?? '')}`
        : source.kind === 'assignment'
          ? `assignments/${source.id.split(':').at(-1)}`
          : `discussion_topics/${source.id.split(':').at(-1)}`;
    const detail = row(await (await request(`courses/${source.courseId}/${path}`)).json());
    source.html = str(detail.body ?? detail.description ?? detail.message);
    source.url = str(detail.html_url);
    getDatabase()
      .prepare('UPDATE canvas_sources SET data=? WHERE id=?')
      .run(JSON.stringify(source), source.id);
  }
  return {
    title: source.title,
    format: source.html !== undefined ? ('html' as const) : ('binary' as const),
    text: source.html,
    url: source.url,
    dueAt: source.dueAt,
    updatedAt: source.updatedAt,
  };
}

// TODO 独立刷新作业，避免定时轮询触发文件、模块和页面的全量同步。
export async function listTodoCanvasCourses() {
  const courses = await list('courses?enrollment_state=active&per_page=50');
  const archived = new Set(
    getCanvasState()
      .courses.filter((c) => c.archived)
      .map((c) => c.id),
  );
  // code 供 TODO 月历与课表共用稳定配色键；name 仅用于展示。
  return courses
    .filter((c) => num(c.id) > 0 && !archived.has(num(c.id)))
    .map((c) => ({
      id: num(c.id),
      name: str(c.name) || str(c.course_code) || `课程 ${num(c.id)}`,
      code: str(c.course_code),
    }));
}

export function listTodoCanvasAssignments(courseId: number) {
  return list(`courses/${courseId}/assignments?include[]=submission&per_page=50`);
}

/** @ 引用候选（通用池会话）：courses 目录下、已下载到本地的最新学期（未归档）课件。
 *  缓存索引在 workspace_settings（canvas-file:* → 本地路径）。 */
export function cachedCourseFiles(): CachedCourseFile[] {
  const state = getCanvasState();
  const latest = latestTermOf(state.courses);
  if (!latest) return [];
  const coursesRoot = join(storageDirectory(), 'courses');
  const roots = state.courses
    .filter((course) => course.term === latest && !course.archived)
    // 按 id 排序让同名课程的 title 归属确定；空名兜底与 sourceDirectory 的目录命名保持一致。
    .sort((a, b) => a.id - b.id)
    .map((course) => ({
      courseName: course.name || `course-${course.id}`,
      courseId: course.id,
      root: join(
        coursesRoot,
        courseTermDirectory(course.term),
        diskName(`${course.name || `course-${course.id}`} [${course.id}]`),
      ),
    }));
  if (!roots.length) return [];
  const rows = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key LIKE 'canvas-file:%'")
    .all() as { value: string }[];
  return pickCourseFiles(
    roots,
    rows.map((row) => row.value),
    existsSync,
  );
}

/** 批量导出所选课程「文件」目录下的课件到 target：复用 cachedFile 按需下载后拷贝，
 *  结构为 <target>/<课程名>/<课程内相对路径>；同名课程目录自动追加 [courseId] 消解。 */
export async function exportCanvasCourseFiles(
  courseIds: number[],
  target: string,
): Promise<CanvasExportResult> {
  const state = getCanvasState();
  const result: CanvasExportResult = { dir: target, exported: 0, failed: [] };
  const taken = new Map<string, number>();
  for (const courseId of courseIds) {
    const course = state.courses.find((item) => item.id === courseId);
    if (!course) continue;
    const name = diskName(course.name || `course-${courseId}`);
    // 与 pickCourseFiles 同一冲突规则：普通名撞车才追加 [courseId]。
    const directory = taken.get(name) === undefined ? name : diskName(`${name} [${courseId}]`);
    taken.set(directory, courseId);
    const entries = collectCourseFileEntries(courseId, state.items);
    if (!entries.length) {
      result.failed.push(`${course.name}：课程目录尚未同步或没有文件`);
      continue;
    }
    for (const entry of entries) {
      const relative = [directory, ...entry.folders, entry.name].join('/');
      try {
        const cached = await cachedFile(getSource(entry.sourceId));
        const dir = join(target, directory, ...entry.folders.map((folder) => diskName(folder)));
        mkdirSync(dir, { recursive: true });
        await copyFile(cached.path, join(dir, diskName(entry.name)));
        result.exported += 1;
      } catch (error) {
        result.failed.push(
          `${relative}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return result;
}
