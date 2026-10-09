import {
  removeWorkspaceEntry,
  prepareStorage,
  getWorkspaceState,
  entry,
  createWorkspaceEntry,
  updateWorkspaceEntry,
  importWorkspaceFiles,
  linkProjectFolder,
  importRemoteProject,
  projectLocation,
  remoteProjectOf,
  workspaceFilePath,
  readWorkspaceEntry,
  saveWorkspaceNote,
  saveNoteImage,
  openProjectDirectory,
} from './api';
import { checkWorkspaceSender } from '../ipc';
import { registerLayoutIpc } from './layout';
import { exportOfficePdf } from '../office-export';
import {
  remoteById,
  remoteFileIndex,
  remoteJoin,
  targetOf,
  withinRemoteRoot,
} from '../remotes/api';
import { listRemoteDirectory } from '../remotes/operations';
import { watchRemoteProject } from '../remotes/watch';
import { resourceRefSchema } from '../../shared/resources';
import { dialog, ipcMain, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { getDatabase } from '../database';
import { storageDirectory as directory } from '../storage';
import type { WorkspaceCreateInput } from '../../shared/api';
import { workspaceEntryIdSchema } from '../../shared/workspace';
import { watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';

const watchers = new Map<string, FSWatcher>();
const subscribers = new Set<WebContents>();
let changedTimer: ReturnType<typeof setTimeout> | undefined;
/** @ 候选上限：超长索引没有实用价值，还会拖慢 composer。 */
const REMOTE_REFERENCE_LIMIT = 3000;
/** 一次能报上去的监视目录数：真到这么多层说明树已经展开得很深，此时 inotify 额度也不宽裕。 */
const REMOTE_WATCH_LIMIT = 4096;
function watchWorkspace(client: WebContents) {
  if (!subscribers.has(client)) {
    subscribers.add(client);
    client.once('destroyed', () => {
      subscribers.delete(client);
      if (!subscribers.size) {
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
      }
    });
  }
  const state = getWorkspaceState();
  const roots = new Set([
    join(state.directory, 'workspace'),
    ...state.entries
      // 远程项目的 path 是远端路径，本地没有可监听目录。
      .filter((item) => item.parentId === null && item.path && !item.remoteId)
      .map((item) =>
        item.kind === 'folder' || item.kind === 'project' ? item.path! : dirname(item.path!),
      ),
  ]);
  for (const root of roots) {
    if (watchers.has(root)) continue;
    try {
      const watcher = watch(root, { recursive: true, persistent: false }, (_event, file) => {
        if (
          file &&
          String(file)
            .split(/[\\/]/)
            .some((part) => part === '.git' || part === 'node_modules')
        )
          return;
        clearTimeout(changedTimer);
        changedTimer = setTimeout(() => {
          for (const subscriber of subscribers)
            if (!subscriber.isDestroyed()) subscriber.send('workspace:changed');
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

/** workspace 通道不依赖 agent 域：会话订阅挂钩由装配层（main/index.ts 经 agent 门面）注入。 */
/** subscribeChat：工作区通道顺带订阅会话推送；invalidateSessions：项目目录变化后让空闲 agent 会话按新 cwd 重建。 */
export function registerWorkspaceIpc(
  subscribeChat: (client: WebContents) => void,
  invalidateSessions: () => void,
) {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`workspace:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      return fn(...args);
    });
  ipcMain.handle('workspace:get-state', (event) => {
    checkWorkspaceSender(event);
    subscribeChat(event.sender);
    watchWorkspace(event.sender);
    return getWorkspaceState();
  });
  handle('open-email-draft', async (id) => {
    const { openEmailDraft } = await import('../mail/drafts');
    return openEmailDraft(id);
  });
  handle('create', (input) => createWorkspaceEntry(input as WorkspaceCreateInput));
  handle('update', (id, input) => {
    const result = updateWorkspaceEntry(workspaceEntryIdSchema.parse(id), input);
    invalidateSessions();
    return result;
  });
  handle('remove', async (value) => {
    await removeWorkspaceEntry(value);
    invalidateSessions();
  });
  handle('read', (id) => readWorkspaceEntry(workspaceEntryIdSchema.parse(id)));
  handle('save-note', (id, text, revision) =>
    saveWorkspaceNote(
      workspaceEntryIdSchema.parse(id),
      z.string().max(2_000_000).parse(text),
      z.string().length(64).parse(revision),
    ),
  );
  handle('save-note-image', (id, name, bytes) =>
    saveNoteImage(
      workspaceEntryIdSchema.parse(id),
      z
        .string()
        .min(1)
        .max(200)
        .refine((value) => !value.includes('/') && !value.includes('\\'))
        .parse(name),
      z
        .instanceof(Uint8Array)
        .refine((value) => value.byteLength > 0)
        .parse(bytes),
    ),
  );
  handle('open-project-directory', openProjectDirectory);
  // 导出过程要把阶段事件推给发起窗口，需要 event，走独立注册。
  ipcMain.handle('workspace:export-office-pdf', (event, ref) => {
    checkWorkspaceSender(event);
    subscribeChat(event.sender);
    // 事件带资源引用：并发导出时 renderer 能把进度归到对应文件。
    const parsed = resourceRefSchema.parse(ref);
    return exportOfficePdf(parsed, (progress) =>
      event.sender.send('workspace:export-office-progress', { ...progress, ref: parsed }),
    );
  });
  handle('import-files', async (value) => {
    const parentId = workspaceEntryIdSchema.nullable().parse(value);
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '导入本地文件',
    });
    if (picked.canceled) return;
    importWorkspaceFiles(parentId, picked.filePaths);
  });
  handle('import-project-folder', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择要作为项目打开的文件夹',
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    return picked.canceled || !path ? null : linkProjectFolder(path);
  });
  handle('import-remote-project', async (remoteId, path) => {
    const created = await importRemoteProject(remoteId, path);
    invalidateSessions();
    return created;
  });
  // 远程目录按需拉取：展开一层拉一层，主进程不缓存（远端是唯一事实来源）。
  handle('list-remote', async (projectId, path) => {
    const location = projectLocation(projectId);
    if (location.kind !== 'remote') throw new Error('该项目不是远程项目');
    const wanted = z.string().min(1).max(4096).parse(path).replace(/\/+$/, '') || '/';
    if (!withinRemoteRoot(location.path, wanted)) throw new Error('只能浏览远程项目目录之内的路径');
    const entries = await listRemoteDirectory(targetOf(remoteById(location.remoteId)), wanted);
    return entries
      .map((entry) => ({ ...entry, path: remoteJoin(wanted, entry.name) }))
      .sort((left, right) =>
        left.directory === right.directory
          ? left.name.localeCompare(right.name)
          : Number(right.directory) - Number(left.directory),
      );
  });
  // 远端目录 watch：渲染端报「当前展开的目录」，helper 侧的变化推回来后走同一条
  // workspace:remote-change，所以 Dela 之外改的远端文件也能自己出现在树里。
  handle('watch-remote', async (projectId, paths) => {
    const location = projectLocation(projectId);
    if (location.kind !== 'remote') throw new Error('该项目不是远程项目');
    const wanted = z
      .array(z.string().min(1).max(4096))
      .max(REMOTE_WATCH_LIMIT)
      .parse(paths)
      .map((path) => path.replace(/\/+$/, '') || '/')
      .filter((path) => withinRemoteRoot(location.path, path));
    const root = location.path.replace(/\/+$/, '') || '/';
    return watchRemoteProject({
      projectId: workspaceEntryIdSchema.parse(projectId),
      target: targetOf(remoteById(location.remoteId)),
      root,
      // 根永远在集合里：reset 时按它报一次，且根被折叠也不该整个失去监视。
      paths: wanted.includes(root) ? wanted : [root, ...wanted],
    });
  });
  handle('remote-references', async (projectId) => {
    const location = projectLocation(projectId);
    if (location.kind !== 'remote') throw new Error('该项目不是远程项目');
    const files = await remoteFileIndex(remoteById(location.remoteId), location.path);
    // @ 候选上限：超长索引没有实用价值，还会拖慢 composer。
    return files.slice(0, REMOTE_REFERENCE_LIMIT).map((file) => ({
      key: remoteJoin(location.path, file),
      title: file,
    }));
  });
  handle('import-dropped-files', (value, paths) => {
    const parentId = workspaceEntryIdSchema.nullable().parse(value);
    importWorkspaceFiles(
      parentId,
      z.array(z.string().min(1).max(32_767)).min(1).max(100).parse(paths),
    );
  });
  handle('open-local', async (value) => {
    prepareStorage();
    const id = workspaceEntryIdSchema.parse(value);
    const item = entry(id);
    if (item.kind === 'project' && remoteProjectOf(id))
      throw new Error('远程项目不在本机，无法用资源管理器打开');
    const path =
      item.kind === 'project' || item.kind === 'folder' ? item.path : await workspaceFilePath(id);
    if (!path) throw new Error('此内容没有本地文件');
    if (item.kind === 'project' || item.kind === 'folder') {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
      return;
    }
    shell.showItemInFolder(path);
  });
  handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: '新建工作区与课程资料的保存位置（已有文件不迁移）',
      defaultPath: directory(),
      properties: ['openDirectory', 'createDirectory'],
    });
    const path = result.filePaths[0];
    if (!result.canceled && path)
      getDatabase()
        .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)")
        .run(path);
    return directory();
  });
  registerLayoutIpc();
}
