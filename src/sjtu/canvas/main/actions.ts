import { dialog, shell } from 'electron';
import { copyFile } from 'node:fs/promises';
import { emit } from '../../../core/ports';
import { publishTodoState, refreshTodos } from '../../../modules/todo';
import { canvasContract, type CanvasState } from '../contract';
import { clearCanvasToken, loadCanvasToken } from './credentials';
import {
  cachedFile,
  configureCanvas,
  exportCanvasCourseFiles,
  getCanvasState,
  getSource,
  isCanvasFileLink,
  linkedCanvasFile,
  syncCanvasCourses,
  syncCanvasCourseTrees,
  type StoredSource,
} from './api';

async function saveSourceAs(source: StoredSource) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: source.title.replace(/[<>:"/\\|?*]/g, '_'),
  });
  if (canceled || !filePath) return;
  const file = await cachedFile(source);
  await copyFile(file.path, filePath);
}

export const downloadSource = (id: string) => saveSourceAs(getSource(id));

export async function revealSource(id: string) {
  const source = getSource(id);
  if (source.kind !== 'file') throw new Error('资料不是文件');
  shell.showItemInFolder((await cachedFile(source)).path);
}

export async function connectCanvas(token: string): Promise<CanvasState> {
  await configureCanvas(token);
  publishTodoState();
  void refreshTodos().catch((error: unknown) => console.error('TODO sync failed', error));
  void refreshCanvasTrees().catch((error: unknown) =>
    console.error('Canvas tree sync failed', error),
  );
  return syncCanvasCourses();
}

export function disconnectCanvas(): CanvasState {
  clearCanvasToken();
  publishTodoState();
  return getCanvasState();
}

export async function exportCourseFiles(courseIds: number[]) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择导出位置',
    properties: ['openDirectory', 'createDirectory'],
  });
  const directory = filePaths[0];
  if (canceled || !directory) return null;
  return exportCanvasCourseFiles(courseIds, directory);
}

/** 课程文件链接改为另存到本地；取不到文件信息时退回系统浏览器。 */
export function openCanvasLink(href: string): boolean {
  const url = URL.parse(href);
  if (!url || !isCanvasFileLink(url)) return false;
  void linkedCanvasFile(url)
    .then((file) => file && saveSourceAs(file))
    .catch(() => shell.openExternal(url.href));
  return true;
}

export function publishCanvasState(): CanvasState {
  const state = getCanvasState();
  emit(canvasContract, 'state', state);
  return state;
}

let activeTreeSync: Promise<CanvasState> | null = null;

export function refreshCanvasTrees(): Promise<CanvasState> {
  if (!loadCanvasToken()) return Promise.resolve(getCanvasState());
  if (activeTreeSync) return activeTreeSync;
  activeTreeSync = syncCanvasCourseTrees()
    .then(publishCanvasState)
    .finally(() => {
      activeTreeSync = null;
    });
  return activeTreeSync;
}
