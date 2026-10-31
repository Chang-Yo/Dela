import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { broadcastTodos, refreshTodos } from '../todo';
import { clearCanvasToken, loadCanvasToken } from '../credentials';
import { checkWorkspaceSender } from '../ipc';
import { isWorkspaceWindow } from '../notifications/system';
import { openShuiyuanLinkInApp } from '../shuiyuan/links';
import {
  getCanvasState,
  configureCanvas,
  syncCanvasCourses,
  syncCanvasCourseTrees,
  exportCanvasCourseFiles,
  syncCanvasCourse,
  getSource,
  cachedFile,
  cachedCourseFiles,
  canvasCacheDirectory,
  canvasCacheStats,
  getCanvasCachePins,
  updateCanvasCachePolicy,
  setCanvasCachePin,
  clearCanvasCache,
  readCanvasSource,
  archiveCanvasCourse,
} from './api';
import type { CanvasState } from '../../shared/api';

export function registerCanvasIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`canvas:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('get-state', getCanvasState);
  handle('configure', async (token) => {
    await configureCanvas(z.string().parse(token));
    broadcastTodos();
    void refreshTodos().catch((error: unknown) => console.error('TODO sync failed', error));
    void refreshCanvasTrees().catch((error: unknown) =>
      console.error('Canvas tree sync failed', error),
    );
  });
  handle('disconnect', () => {
    clearCanvasToken();
    broadcastTodos();
  });
  handle('sync-courses', syncCanvasCourses);
  handle('sync-course', (id) => syncCanvasCourse(z.number().int().positive().parse(id)));
  handle('archive-course', (id, archived) =>
    archiveCanvasCourse(z.number().int().positive().parse(id), z.boolean().parse(archived)),
  );
  handle('read', (id) => readCanvasSource(z.string().max(512).parse(id)));
  handle('download', async (id) => {
    const source = getSource(z.string().parse(id));
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: source.title.replace(/[<>:"/\\|?*]/g, '_'),
    });
    if (canceled || !filePath) return;
    const file = await cachedFile(source);
    await copyFile(file.path, filePath);
  });
  handle('reveal', async (id) => {
    const source = getSource(z.string().parse(id));
    if (source.kind !== 'file') throw new Error('资料不是文件');
    shell.showItemInFolder((await cachedFile(source)).path);
  });
  handle('open-link', async (value) => {
    const url = new URL(z.string().max(8192).parse(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('不支持的链接');
    if (!openShuiyuanLinkInApp(url.href)) await shell.openExternal(url.href);
  });
  handle('cache-stats', canvasCacheStats);
  handle('cache-pins', getCanvasCachePins);
  handle('update-cache-policy', (policy) =>
    updateCanvasCachePolicy(
      z
        .object({
          enabled: z.boolean(),
          maxBytes: z
            .number()
            .finite()
            .min(100 * 1024 ** 2),
          keepCurrentTerm: z.boolean(),
        })
        .parse(policy),
    ),
  );
  handle('set-cache-pin', (scope, pinned) =>
    setCanvasCachePin(
      z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('file'), fileId: z.number().int().positive() }),
          z.object({ kind: z.literal('course'), courseId: z.number().int().positive() }),
        ])
        .parse(scope),
      z.boolean().parse(pinned),
    ),
  );
  handle('clear-cache', (scope) =>
    clearCanvasCache(
      z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('all') }),
          z.object({ kind: z.literal('term'), term: z.string().min(1).max(200) }),
          z.object({ kind: z.literal('course'), courseId: z.number().int().positive() }),
        ])
        .parse(scope),
    ),
  );
  handle('open-cache-directory', async () => {
    const directory = canvasCacheDirectory();
    await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(`无法打开缓存目录：${error}`);
  });
  handle('cached-files', () => cachedCourseFiles());
  handle('export-course-files', async (ids) => {
    const courseIds = z.array(z.number().int().positive()).min(1).parse(ids);
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择导出位置',
      properties: ['openDirectory', 'createDirectory'],
    });
    const directory = filePaths[0];
    if (canceled || !directory) return null;
    return exportCanvasCourseFiles(courseIds, directory);
  });
}

export function broadcastCanvasState(): CanvasState {
  const state = getCanvasState();
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL()))
      window.webContents.send('canvas:state', state);
  return state;
}

let activeTreeSync: Promise<CanvasState> | null = null;

/** 后台目录同步入口（每小时定时器与配置令牌后共用）：未连接时静默跳过，进行中时复用同一任务。 */
export function refreshCanvasTrees(): Promise<CanvasState> {
  if (!loadCanvasToken()) return Promise.resolve(getCanvasState());
  if (activeTreeSync) return activeTreeSync;
  activeTreeSync = syncCanvasCourseTrees()
    .then((state) => {
      broadcastCanvasState();
      return state;
    })
    .finally(() => {
      activeTreeSync = null;
    });
  return activeTreeSync;
}
