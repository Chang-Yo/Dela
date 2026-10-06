import {
  removeWorkspaceEntry,
  idSchema,
  prepareStorage,
  getWorkspaceState,
  entry,
  createWorkspaceEntry,
  updateWorkspaceEntry,
  importWorkspaceFiles,
  notePath,
  readWorkspaceEntry,
  saveWorkspaceNote,
  saveNoteImage,
  createMarkdownNoteCopy,
  openEntryExternally,
} from './api';
import { checkWorkspaceSender } from '../ipc';
import { registerLayoutIpc } from './layout';
import { exportOfficePdf, quickLookFile } from '../office-export';
import { resourceRefSchema } from '../../shared/resources';
import { dialog, ipcMain, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { getDatabase } from '../database';
import { storageDirectory as directory } from '../storage';
import type { WorkspaceCreateInput } from '../../shared/api';

/** workspace 通道不依赖 agent 域：会话订阅挂钩由装配层（main/index.ts 经 agent 门面）注入。 */
export function registerWorkspaceIpc(subscribeChat: (client: WebContents) => void) {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`workspace:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      subscribeChat(event.sender);
      return fn(...args);
    });
  handle('get-state', getWorkspaceState);
  handle('open-email-draft', async (id) => {
    const { openEmailDraft } = await import('../mail/drafts');
    return openEmailDraft(id);
  });
  handle('create', (input) => createWorkspaceEntry(input as WorkspaceCreateInput));
  handle('update', (id, input) => updateWorkspaceEntry(idSchema.parse(id), input));
  handle('remove', (value) => removeWorkspaceEntry(value));
  handle('read', (id) => readWorkspaceEntry(idSchema.parse(id)));
  handle('save-note', (id, text, revision) =>
    saveWorkspaceNote(
      idSchema.parse(id),
      z.string().max(2_000_000).parse(text),
      z.string().length(64).parse(revision),
    ),
  );
  handle('save-note-image', (id, name, bytes) =>
    saveNoteImage(
      idSchema.parse(id),
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
  handle('create-note-copy', (id, parentId) =>
    createMarkdownNoteCopy(idSchema.parse(id), idSchema.nullable().parse(parentId ?? null)),
  );
  handle('open-external', (id) => openEntryExternally(idSchema.parse(id)));
  // 导出过程要把阶段事件推给发起窗口，与 quick-look 一样需要 event，走独立注册。
  ipcMain.handle('workspace:export-office-pdf', (event, ref) => {
    checkWorkspaceSender(event);
    subscribeChat(event.sender);
    // 事件带资源引用：并发导出时 renderer 能把进度归到对应文件。
    const parsed = resourceRefSchema.parse(ref);
    return exportOfficePdf(parsed, (progress) =>
      event.sender.send('workspace:export-office-progress', { ...progress, ref: parsed }),
    );
  });
  // Quick Look 需要 sender 定位所属窗口，走独立注册而非丢弃 event 的 handle 包装。
  ipcMain.handle('workspace:quick-look', (event, ref) => {
    checkWorkspaceSender(event);
    subscribeChat(event.sender);
    return quickLookFile(event.sender, ref);
  });
  handle('import-files', async (value) => {
    const parentId = idSchema.nullable().parse(value);
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '导入本地文件',
    });
    if (picked.canceled) return;
    importWorkspaceFiles(parentId, picked.filePaths);
  });
  handle('import-dropped-files', (value, paths) => {
    const parentId = idSchema.nullable().parse(value);
    importWorkspaceFiles(
      parentId,
      z.array(z.string().min(1).max(32_767)).min(1).max(100).parse(paths),
    );
  });
  handle('open-local', async (value) => {
    prepareStorage();
    const id = idSchema.parse(value);
    const item = entry(id);
    const stored = getDatabase()
      .prepare('SELECT local_path AS path FROM workspace_entries WHERE id=?')
      .get(id) as { path: string | null };
    const path = item.kind === 'note' ? notePath(item) : stored.path;
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
