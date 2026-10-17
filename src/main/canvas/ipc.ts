import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { broadcastTodos, refreshTodos } from '../todo';
import { getDatabase } from '../database';
import { clearCanvasToken, loadCanvasToken } from '../credentials';
import { checkWorkspaceSender } from '../ipc';
import { latestTermOf, type CanvasState } from '../../shared/canvas';
import {
  getCanvasState,
  configureCanvas,
  syncCanvasCourses,
  type StoredSource,
  syncCanvasCourse,
  getSource,
  cachedFile,
  cachedCourseFiles,
  readCanvasSource,
  archiveCanvasCourse,
} from './api';

function broadcastCanvas(): CanvasState {
  const state = getCanvasState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (
      url.startsWith('http://127.0.0.1:5173/') ||
      (url.startsWith('file:') && /\/renderer\/index\.html(?:\?|$)/.test(url))
    )
      window.webContents.send('canvas:changed', state);
  }
  return state;
}

let activeRefresh: { token: string | null; work: Promise<CanvasState> } | undefined;
export function refreshCanvas(): Promise<CanvasState> {
  const token = loadCanvasToken();
  if (activeRefresh?.token === token) return activeRefresh.work;
  const work = (async () => {
    if (!token) return getCanvasState();
    const state = await syncCanvasCourses();
    broadcastCanvas();
    const latest = latestTermOf(state.courses);
    for (const { id } of state.courses) {
      if (loadCanvasToken() !== token) break;
      const course = getCanvasState().courses.find((item) => item.id === id);
      if (!course || course.term !== latest || course.archived) continue;
      await syncCanvasCourse(id);
      broadcastCanvas();
    }
    return getCanvasState();
  })().finally(() => {
    if (activeRefresh?.work === work) activeRefresh = undefined;
  });
  activeRefresh = { token, work };
  return work;
}

async function refreshInBackground() {
  try {
    await refreshCanvas();
  } catch (error) {
    console.error('Canvas background sync failed', error);
  }
}

export function startCanvasSync(): () => void {
  void refreshInBackground();
  const timer = setInterval(refreshInBackground, 60 * 60_000);
  return () => clearInterval(timer);
}

export function registerCanvasIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(`canvas:${name}`, (event, ...args) => {
      checkWorkspaceSender(event);
      return fn(...args);
    });
  handle('get-state', async () => {
    // Relocate only already-downloaded legacy files; listing courses never starts a download.
    const rows = getDatabase().prepare('SELECT data FROM canvas_sources').all() as {
      data: string;
    }[];
    for (const row of rows) {
      const source: StoredSource = JSON.parse(row.data);
      if (source.kind !== 'file' || !source.fileId) continue;
      const key = createHash('sha256')
        .update(`${source.fileId}:${source.updatedAt ?? ''}`)
        .digest('hex');
      if (existsSync(join(app.getPath('userData'), 'canvas-cache', key))) await cachedFile(source);
    }
    return getCanvasState();
  });
  handle('configure', async (token) => {
    await configureCanvas(z.string().parse(token));
    void refreshInBackground();
    broadcastTodos();
    void refreshTodos().catch((error: unknown) => console.error('TODO sync failed', error));
  });
  handle('disconnect', () => {
    clearCanvasToken();
    broadcastCanvas();
    broadcastTodos();
  });
  handle('sync-courses', syncCanvasCourses);
  handle('refresh', refreshCanvas);
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
  handle('open-link', async (value) => {
    const url = new URL(z.string().max(8192).parse(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('不支持的链接');
    await shell.openExternal(url.href);
  });
  handle('cached-files', () => cachedCourseFiles());
}
