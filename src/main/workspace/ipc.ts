import {
  removeWorkspaceEntry,
  prepareStorage,
  getWorkspaceState,
  entry,
  createWorkspaceEntry,
  updateWorkspaceEntry,
  importWorkspaceFiles,
  workspaceFilePath,
  readWorkspaceEntry,
  saveWorkspaceNote,
  saveNoteImage,
  openProjectDirectory,
} from './api';
import { checkWorkspaceSender } from '../ipc';
import { registerLayoutIpc } from './layout';
import { exportOfficePdf } from '../office-export';
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
      .filter((item) => item.parentId === null && item.path)
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
