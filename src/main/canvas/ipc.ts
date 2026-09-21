import { app, dialog, ipcMain, shell } from 'electron';
import { copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { clearCanvasToken } from '../credentials';
import { checkWorkspaceSender } from '../ipc';
import {
  getCanvasState,
  configureCanvas,
  syncCanvasCourses,
  type StoredSource,
  syncCanvasCourse,
  getSource,
  cachedFile,
  readCanvasSource,
  archiveCanvasCourse,
} from './api';

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
  handle('configure', (token) => configureCanvas(z.string().parse(token)));
  handle('disconnect', () => clearCanvasToken());
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
  handle('open-link', async (value) => {
    const url = new URL(z.string().max(8192).parse(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('不支持的链接');
    await shell.openExternal(url.href);
  });
}
