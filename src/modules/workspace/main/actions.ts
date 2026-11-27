import { prepareStorage, entry, projectLocation, remoteProjectOf, workspaceFilePath } from './api';
import {
  downloadRemoteFile,
  remoteById,
  remoteJoin,
  targetOf,
  uploadLocalFile,
  withinRemoteRoot,
} from '../../remotes';
import { listRemoteDirectory, remoteFileIndex } from '../../../core/remote/operations';
import { notifyRemoteChange } from '../../../core/remote/events';
import { watchRemoteProject } from '../../../core/remote/watch';
import { getLocalWorkspaceState, searchLocalWorkspace } from './local-tree';
import { workspaceContract, type WorkspaceState } from '../contract';
import { dialog, shell } from 'electron';
import { emit, hostPorts } from '../../../core/ports';
import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

const watchers = new Map<string, FSWatcher>();
let changedTimer: ReturnType<typeof setTimeout> | undefined;
const changedPaths = new Set<string>();
const REMOTE_REFERENCE_LIMIT = 3000;

function watchWorkspace(state: WorkspaceState) {
  const roots = new Set([
    join(state.directory, 'workspace'),
    ...state.entries
      .filter((item) => item.parentId === null && item.path && !item.remoteId)
      .map((item) =>
        item.kind === 'folder' || item.kind === 'project' ? item.path! : dirname(item.path!),
      ),
  ]);
  for (const root of roots) {
    if (
      [...roots].some((parent) => {
        if (parent === root) return false;
        const suffix = relative(parent, root);
        return (
          !isAbsolute(suffix) &&
          suffix !== '..' &&
          !suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        );
      })
    )
      roots.delete(root);
  }
  for (const [root, watcher] of watchers) {
    if (roots.has(root)) continue;
    watcher.close();
    watchers.delete(root);
  }
  for (const root of roots) {
    if (watchers.has(root)) continue;
    try {
      const watcher = watch(root, { recursive: true, persistent: false }, (event, file) => {
        // 目录清单不含内容或 mtime；内容写入不应使整棵树和引用候选失效。
        const ignoreRules =
          file &&
          (basename(String(file)) === '.gitignore' ||
            /\.git[\\/]info[\\/]exclude$/.test(String(file)));
        if (event === 'change' && !ignoreRules) return;
        if (
          file &&
          !ignoreRules &&
          String(file)
            .split(/[\\/]/)
            .some((part) => part === '.git' || part === 'node_modules')
        )
          return;
        changedPaths.add(file ? join(root, String(file)) : root);
        clearTimeout(changedTimer);
        changedTimer = setTimeout(() => {
          const paths = [...changedPaths];
          changedPaths.clear();
          emit(workspaceContract, 'changed', paths);
        }, 200);
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(root);
      });
      watchers.set(root, watcher);
    } catch {
      /* 聚焦时重读仍可发现变化。 */
    }
  }
}

export async function workspaceState(): Promise<WorkspaceState> {
  const state = await getLocalWorkspaceState();
  watchWorkspace(state);
  return state;
}

const searches = new Map<string, AbortController>();

export async function searchLocal(rootId: string | null, query: string) {
  const key = rootId ?? '';
  searches.get(key)?.abort();
  if (!query.trim()) {
    searches.delete(key);
    return [];
  }
  const controller = new AbortController();
  searches.set(key, controller);
  try {
    return await searchLocalWorkspace(rootId, query, controller.signal);
  } finally {
    if (searches.get(key) === controller) searches.delete(key);
  }
}

export async function pickImportFiles(): Promise<string[]> {
  const picked = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: '导入本地文件',
  });
  return picked.canceled ? [] : picked.filePaths;
}

export async function pickProjectFolder(): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    title: '选择要作为项目打开的文件夹',
    properties: ['openDirectory'],
  });
  const path = picked.filePaths[0];
  return picked.canceled || !path ? null : path;
}

// 远端通道共用入口：路径一律先判「在项目根之内」，集中一处校验，漏判即越界读写。
export function remoteTargetOf(projectId: string) {
  const location = projectLocation(projectId);
  if (location.kind !== 'remote') throw new Error('该项目不是远程项目');
  return {
    target: targetOf(remoteById(location.remoteId)),
    root: location.path.replace(/\/+$/, '') || '/',
  };
}

export function remotePathIn(root: string, value: string) {
  const path = value.replace(/\/+$/, '') || '/';
  if (!withinRemoteRoot(root, path)) throw new Error('只能访问远程项目目录之内的路径');
  return path;
}

export async function listRemote(projectId: string, path: string) {
  const { target, root } = remoteTargetOf(projectId);
  const wanted = remotePathIn(root, path);
  const entries = await listRemoteDirectory(target, wanted);
  return entries
    .map((entry) => ({ ...entry, path: remoteJoin(wanted, entry.name) }))
    .sort((left, right) =>
      left.directory === right.directory
        ? left.name.localeCompare(right.name)
        : Number(right.directory) - Number(left.directory),
    );
}

export async function downloadRemote(projectId: string, path: string) {
  const { target, root } = remoteTargetOf(projectId);
  const wanted = remotePathIn(root, path);
  const result = await dialog.showSaveDialog({
    title: '下载到本地',
    defaultPath: basename(wanted),
  });
  if (result.canceled || !result.filePath) return null;
  await downloadRemoteFile(target, wanted, result.filePath);
  shell.showItemInFolder(result.filePath);
  return result.filePath;
}

export async function uploadRemote(projectId: string, directory: string, paths: string[] | null) {
  const { target, root } = remoteTargetOf(projectId);
  const wanted = remotePathIn(root, directory);
  const chosen =
    paths ??
    (
      await dialog.showOpenDialog({
        title: '上传到远端',
        properties: ['openFile', 'multiSelections'],
      })
    ).filePaths;
  if (!chosen.length) return [];
  const written: string[] = [];
  for (const local of chosen) written.push(await uploadLocalFile(target, local, wanted));
  notifyRemoteChange(wanted);
  return written;
}

/** 越界的路径直接丢掉而不报错：集合来自界面的展开状态，报错会让整棵树失联。 */
export function watchRemote(projectId: string, paths: string[]) {
  const { target, root } = remoteTargetOf(projectId);
  const wanted = paths
    .map((path) => path.replace(/\/+$/, '') || '/')
    .filter((path) => withinRemoteRoot(root, path));
  return watchRemoteProject({
    projectId,
    target,
    root,
    paths: wanted.includes(root) ? wanted : [root, ...wanted],
  });
}

export async function remoteReferences(projectId: string) {
  const { target, root } = remoteTargetOf(projectId);
  const files = await remoteFileIndex(target, root, REMOTE_REFERENCE_LIMIT);
  return files.map((file) => ({ key: remoteJoin(root, file), title: file }));
}

export async function openLocal(id: string) {
  prepareStorage();
  const item = entry(id);
  if (item.kind === 'project' && remoteProjectOf(id))
    throw new Error('远程项目不在本机，无法在本机打开目录');
  const path =
    item.kind === 'project' || item.kind === 'folder' ? item.path : await workspaceFilePath(id);
  if (!path) throw new Error('此内容没有本地文件');
  if (item.kind === 'project' || item.kind === 'folder') {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
    return;
  }
  shell.showItemInFolder(path);
}

export async function openFile(id: string) {
  prepareStorage();
  const path = await workspaceFilePath(id);
  if (!path) throw new Error('此内容没有本地文件');
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

export async function chooseDirectory() {
  const result = await dialog.showOpenDialog({
    title: '新建工作区与课程资料的保存位置（已有文件不迁移）',
    defaultPath: hostPorts().paths.storage(),
    properties: ['openDirectory', 'createDirectory'],
  });
  const path = result.filePaths[0];
  if (!result.canceled && path) hostPorts().paths.setStorage(path);
  return hostPorts().paths.storage();
}
