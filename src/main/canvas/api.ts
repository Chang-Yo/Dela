import { app } from 'electron';
import { copyFile, link, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants, copyFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { getDatabase } from '../database';
import { availablePath, diskName, storageDirectory } from '../storage';
import { loadCanvasToken, saveCanvasToken } from '../credentials';
import type { CanvasCourse, CanvasState, DocumentContent, SourceItem } from '../../shared/api';

const origin = 'https://oc.sjtu.edu.cn';
const apiRoot = `${origin}/api/v1/`;
type Row = Record<string, unknown>;
export const rowSchema = z.record(z.string(), z.unknown());
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
  if (url.origin !== origin || !url.pathname.startsWith('/api/v1/'))
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

export function getSource(id: string): StoredSource {
  const stored = getDatabase().prepare('SELECT data FROM canvas_sources WHERE id=?').get(id) as
    { data: string } | undefined;
  if (!stored) throw new Error('资料尚未同步，请刷新所属课程');
  return JSON.parse(stored.data);
}

const downloads = new Map<string, Promise<{ path: string; mime: string }>>();
export function cachedFile(source: StoredSource): Promise<{ path: string; mime: string }> {
  const key = `${source.id}:${source.updatedAt ?? ''}`;
  const existing = downloads.get(key);
  if (existing) return existing;
  const work = downloadFile(source).finally(() => downloads.delete(key));
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
  const key = createHash('sha256')
    .update(`${source.fileId}:${source.updatedAt ?? ''}`)
    .digest('hex');
  const db = getDatabase();
  const cacheKey = `canvas-file:${key}`;
  const cached = db.prepare('SELECT value FROM workspace_settings WHERE key=?').get(cacheKey) as
    { value: string } | undefined;
  const dir = sourceDirectory(source);
  if (cached && existsSync(cached.value)) {
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
  const storeLegacy = (legacyPath: string) => {
    const path = availablePath(dir, source.title);
    copyFileSync(legacyPath, path, constants.COPYFILE_EXCL);
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(cacheKey, path);
    return path;
  };
  const legacy = join(app.getPath('userData'), 'canvas-cache', key);
  if (existsSync(legacy))
    return { path: storeLegacy(legacy), mime: source.mime || 'application/octet-stream' };
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
  const mime = str(metadata['content-type']) || 'application/octet-stream';
  source.mime = mime;
  getDatabase()
    .prepare('UPDATE canvas_sources SET data=? WHERE id=?')
    .run(JSON.stringify(source), source.id);
  return { path, mime };
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

export async function canvasPdfPath(id: string): Promise<string> {
  const source = getSource(z.string().max(512).parse(id));
  if (source.kind !== 'file') throw new Error('资料不是 PDF 文件');
  const cached = await cachedFile(source);
  if (!(await isPdf(cached.path))) throw new Error('资料不是 PDF 文件');
  return cached.path;
}

export async function readCanvasSource(id: string): Promise<DocumentContent> {
  const source = getSource(id);
  if (source.kind === 'file') {
    const cached = await cachedFile(source);
    const pdf = await isPdf(cached.path);
    const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(cached.mime);
    const bytes = image ? new Uint8Array(await readFile(cached.path)) : undefined;
    return {
      title: source.title,
      format: pdf ? 'pdf' : image ? 'image' : 'unsupported',
      bytes,
      previewUrl: pdf
        ? `dela-resource://canvas/${encodeURIComponent(id)}?v=${encodeURIComponent(source.updatedAt ?? '')}`
        : undefined,
      mime: pdf ? 'application/pdf' : cached.mime,
      updatedAt: source.updatedAt,
    };
  }
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
    format: source.html !== undefined ? 'html' : 'unsupported',
    text: source.html,
    url: source.url,
    dueAt: source.dueAt,
    updatedAt: source.updatedAt,
  };
}
