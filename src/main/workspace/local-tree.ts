import { mkdir, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { getDatabase } from '../database';
import { storageDirectory } from '../storage';
import { entry, prepareStorage, remoteProjectOf } from './api';
import {
  workspaceArchiveId,
  hiddenWorkspaceNames,
  type WorkspaceEntry,
  type WorkspaceState,
} from '../../shared/workspace';

function storedEntries(): WorkspaceEntry[] {
  return getDatabase()
    .prepare(
      `SELECT id, parent_id AS parentId, name, kind,
    source_id AS sourceId, local_path AS path, remote_id AS remoteId,
    updated_at AS updatedAt FROM workspace_entries`,
    )
    .all() as WorkspaceEntry[];
}

function within(root: string, path: string) {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`);
}

async function markGitIgnored(entries: WorkspaceEntry[], cwd: string) {
  const files = entries.filter((item) => item.path && !item.remoteId && item.kind !== 'source');
  if (!files.length) return entries;
  const input = files.map((item) => item.path!.replaceAll('\\', '/')).join('\0') + '\0';
  const ignored = await new Promise<Set<string>>((done) => {
    const child = execFile(
      'git',
      ['check-ignore', '--stdin', '-z'],
      {
        cwd,
        windowsHide: true,
        timeout: 3000,
        maxBuffer: Math.max(1024 * 1024, Buffer.byteLength(input) * 2),
      },
      (error, stdout) =>
        done(
          new Set(
            error
              ? []
              : stdout
                  .split('\0')
                  .filter(Boolean)
                  .map((path) => resolve(path)),
          ),
        ),
    );
    // 非仓库或 Git 提前退出时，stdin 可能关闭；目录浏览仍正常返回。
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
  return entries.map((item) => ({
    ...item,
    gitIgnored: Boolean(item.path && ignored.has(resolve(item.path))),
  }));
}

async function readDirectory(path: string, parentId: string | null, stored: WorkspaceEntry[]) {
  const identities = new Map(
    stored
      .filter((item) => item.path && item.kind !== 'source' && !item.remoteId)
      .map((item) => [resolve(item.path!), item]),
  );
  const children = await readdir(path, { withFileTypes: true });
  const entries: WorkspaceEntry[] = [];
  for (const child of children) {
    if (hiddenWorkspaceNames.has(child.name)) continue;
    if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
    const file = join(path, child.name);
    const identity = identities.get(file);
    entries.push({
      id: identity?.id ?? file,
      parentId,
      name: child.name,
      kind: child.isDirectory() ? (identity?.kind ?? 'folder') : 'file',
      sourceId: null,
      path: file,
      // 列表只需要名称和类型；mtime 在文件读取时获取，避免每行额外 stat。
      updatedAt: identity?.updatedAt ?? '',
    });
  }
  for (const item of stored) {
    if (item.kind !== 'source') continue;
    const container = item.path ?? stored.find((parent) => parent.id === item.parentId)?.path;
    if ((container && resolve(container) === path) || (!container && item.parentId === parentId))
      entries.push({ ...item, path: undefined, parentId });
  }
  return entries;
}

export async function listLocalDirectory(id: string | null): Promise<WorkspaceEntry[]> {
  prepareStorage();
  if (id && remoteProjectOf(id)) throw new Error('远程目录请通过远程接口读取');
  const parent = id ? entry(id) : null;
  if (parent && parent.kind !== 'project' && parent.kind !== 'folder')
    throw new Error('请选择目录');
  const path = parent?.path ?? join(storageDirectory(), 'workspace');
  return markGitIgnored(await readDirectory(resolve(path), id, storedEntries()), path);
}

export async function localEntryAncestors(id: string): Promise<WorkspaceEntry[]> {
  prepareStorage();
  if (remoteProjectOf(id)) return [];
  const stored = storedEntries();
  const item = entry(id);
  if (!item.path) return [item];
  const root = join(storageDirectory(), 'workspace');
  const project = stored
    .filter(
      (candidate) =>
        !candidate.remoteId &&
        candidate.kind === 'project' &&
        candidate.path &&
        within(candidate.path, item.path!),
    )
    .sort((a, b) => a.path!.length - b.path!.length)[0];
  const boundary = project?.path ?? (within(root, item.path) ? root : dirname(item.path));
  const chain: WorkspaceEntry[] = [];
  let path = item.path;
  while (path !== boundary) {
    const current = entry(path);
    chain.unshift(current);
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  if (project) chain.unshift(project);
  for (let index = 0; index < chain.length; index++)
    chain[index] = { ...chain[index]!, parentId: chain[index - 1]?.id ?? null };
  return chain;
}

/** 导入只返回根清单和已登记身份；目录后代由展开、检索分别读取。 */
export async function getLocalWorkspaceState(): Promise<WorkspaceState> {
  prepareStorage();
  const directory = storageDirectory();
  const root = join(directory, 'workspace');
  const stored = storedEntries();
  // prepareStorage 不保证无归档种子行的测试库已有 workspace。
  await mkdir(root, { recursive: true });
  const entries = await markGitIgnored(await readDirectory(root, null, stored), root);
  const byPath = new Map(
    entries.filter((item) => item.path).map((item) => [resolve(item.path!), item]),
  );
  const identities = new Map(
    stored
      .filter((item) => item.path && item.kind !== 'source' && !item.remoteId)
      .map((item) => [resolve(item.path!), item]),
  );
  const add = async (path: string): Promise<WorkspaceEntry | null> => {
    path = resolve(path);
    if (path === root) return null;
    if (byPath.has(path)) return byPath.get(path)!;
    const identity = identities.get(path);
    let info;
    try {
      info = await stat(path);
    } catch {
      return null;
    }
    const hasParent =
      within(root, path) ||
      stored.some(
        (item) =>
          !item.remoteId &&
          item.kind === 'project' &&
          item.path &&
          resolve(item.path) !== path &&
          within(resolve(item.path), path),
      );
    const parent = hasParent ? await add(dirname(path)) : null;
    const item: WorkspaceEntry = {
      id: identity?.id ?? path,
      parentId: parent?.id ?? null,
      name: basename(path),
      kind: info.isDirectory() ? (identity?.kind ?? 'folder') : 'file',
      sourceId: null,
      path,
      updatedAt: identity?.updatedAt ?? '',
    };
    byPath.set(path, item);
    entries.push(item);
    return item;
  };
  for (const item of stored) {
    if (item.remoteId) {
      entries.push({ ...item, parentId: null });
      continue;
    }
    if (item.path && item.kind !== 'source') await add(item.path);
  }
  return {
    entries: entries.filter((item) => item.id !== workspaceArchiveId),
    directory,
    archivePath: stored.find((item) => item.id === workspaceArchiveId)?.path,
  };
}

/** 名称检索与引用独立于目录缓存，不读取文件正文，也不要求先展开目录。 */
export async function searchLocalWorkspace(
  rootId: string | null,
  query: string,
  signal?: AbortSignal,
): Promise<WorkspaceEntry[]> {
  const stored = storedEntries();
  const roots = rootId ? [entry(rootId)] : (await getLocalWorkspaceState()).entries;
  const found = new Map<string, WorkspaceEntry>();
  const seen = new Set<string>();
  const pending = roots.map((item) => ({ item, ancestors: [] as WorkspaceEntry[] }));
  const needle = query.toLocaleLowerCase();
  while (pending.length) {
    if (signal?.aborted) return [];
    const { item, ancestors } = pending.pop()!;
    if (seen.has(item.id) || item.remoteId || hiddenWorkspaceNames.has(item.name)) continue;
    seen.add(item.id);
    if (item.name.toLocaleLowerCase().includes(needle)) {
      for (const parent of ancestors) found.set(parent.id, parent);
      found.set(item.id, item);
    }
    if (
      !item.path ||
      !['folder', 'project'].includes(item.kind) ||
      ['.git', 'node_modules'].includes(item.name)
    )
      continue;
    try {
      const children = await readDirectory(resolve(item.path), item.id, stored);
      for (const child of children) pending.push({ item: child, ancestors: [...ancestors, item] });
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  const results = [...found.values()];
  if (!query.trim()) return results;
  // 搜索结果按根批量修饰，避免遍历每个目录时启动 Git。
  const directories = rootId
    ? roots
        .filter((root) => root.path)
        .map((root) => (root.kind === 'file' ? dirname(root.path!) : root.path!))
    : [
        join(storageDirectory(), 'workspace'),
        ...stored
          .filter((item) => item.kind === 'project' && item.path && !item.remoteId)
          .map((item) => item.path!),
      ];
  const decorated = await Promise.all(
    [...new Set(directories)].map((directory) =>
      markGitIgnored(
        results.filter((item) => item.path && within(directory, item.path)),
        directory,
      ),
    ),
  );
  const byId = new Map(decorated.flat().map((item) => [item.id, item]));
  return results.map((item) => byId.get(item.id) ?? item);
}
