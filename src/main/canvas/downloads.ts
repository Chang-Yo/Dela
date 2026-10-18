import { BrowserWindow, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type {
  CanvasDownload,
  CanvasDownloadSelection,
  CanvasState,
  SourceItem,
} from '../../shared/canvas';
import { diskName } from '../storage';
import { canvasExportFile, getCanvasState, syncCanvasCourse } from './api';

const message = (error: unknown) => (error instanceof Error ? error.message : '下载失败，请重试');

export function canvasDownloadPlan(state: CanvasState, selection: CanvasDownloadSelection) {
  const course = state.courses.find((item) => item.id === selection.courseId);
  if (!course) throw new Error('课程不存在，请刷新课程列表');
  const items = state.items.filter((item) => item.courseId === course.id);
  const byId = new Map(items.map((item) => [item.id, item]));
  const selected = selection.itemId ? byId.get(selection.itemId) : undefined;
  if (selection.itemId && (!selected || !['folder', 'module'].includes(selected.kind)))
    throw new Error('文件夹不存在，请刷新所属课程');
  const ancestors = (item: SourceItem) => {
    const chain: SourceItem[] = [];
    const seen = new Set<string>([item.id]);
    let parentId = item.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw new Error('课程文件目录包含循环');
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new Error('课程文件目录不完整，请刷新所属课程');
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  };
  // 同一份文件在文件树与模块中可以重复出现；整门课程优先使用原文件树。
  const candidates = items.filter(
    (item) =>
      !selected ||
      item.id === selected.id ||
      ancestors(item).some((parent) => parent.id === selected.id),
  );
  const names = new Map<string, string>();
  const used = new Map<string | null, Set<string>>();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const siblings = used.get(item.parentId) ?? new Set<string>();
    used.set(item.parentId, siblings);
    const safe = diskName(item.name);
    const extension = item.kind === 'file' ? extname(safe) : '';
    const stem = extension ? safe.slice(0, -extension.length) : safe;
    let name = safe;
    for (let index = 2; siblings.has(name.normalize('NFC').toLowerCase()); index += 1)
      name = `${stem} (${index})${extension}`;
    siblings.add(name.normalize('NFC').toLowerCase());
    names.set(item.id, name);
  }
  const pathOf = (item: SourceItem) =>
    [...ancestors(item), item].map((node) => names.get(node.id)!).join('/');
  const directories = new Set(
    candidates.filter((item) => ['folder', 'module'].includes(item.kind)).map(pathOf),
  );
  const sourceIds = new Set<string>();
  const files: CanvasDownload['files'] = [];
  const inFiles = (item: SourceItem) =>
    ancestors(item).some((parent) => parent.id === `${course.id}:files`);
  const fileItems = candidates
    .filter((item) => item.kind === 'file' && item.sourceId)
    .sort((a, b) => Number(inFiles(b)) - Number(inFiles(a)) || a.id.localeCompare(b.id));
  for (const item of fileItems) {
    if (sourceIds.has(item.sourceId!)) continue;
    sourceIds.add(item.sourceId!);
    for (const parent of ancestors(item)) directories.add(pathOf(parent));
    files.push({ sourceId: item.sourceId!, path: pathOf(item), state: 'queued' });
  }
  return {
    title: selected ? `${course.name} / ${selected.name}` : course.name,
    folder: diskName(`${course.name} [${course.id}]`),
    files,
    directories: [...directories],
    warning: course.error
      ? `资料目录同步有异常，结果仅包含已列出的文件：${course.error}`
      : undefined,
  };
}

type Task = {
  view: CanvasDownload;
  selection: CanvasDownloadSelection;
  parent: string;
  directories: string[];
  prepared: boolean;
  stop: boolean;
};
const tasks = new Map<string, Task>();
let running = false;

export function canvasDownloads(): CanvasDownload[] {
  return structuredClone([...tasks.values()].map((task) => task.view));
}

function publish() {
  const downloads = canvasDownloads();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (
      url.startsWith('http://127.0.0.1:5173/') ||
      (url.startsWith('file:') && /\/renderer\/index\.html(?:\?|$)/.test(url))
    )
      window.webContents.send('canvas:downloads-changed', downloads);
  }
}

// 只在用户选中的目录内创建普通目录；不跟随其内部已有的符号链接。
async function ensureDirectory(parent: string, parts: string[]) {
  let path = parent;
  for (const part of parts) {
    path = join(path, part);
    try {
      await mkdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`保存位置不是普通文件夹：${path}`);
  }
  return path;
}

async function run(task: Task) {
  const view = task.view;
  try {
    if (!task.prepared) {
      view.state = 'preparing';
      publish();
      const state = await syncCanvasCourse(task.selection.courseId);
      if (task.stop) return;
      const plan = canvasDownloadPlan(state, task.selection);
      view.title = plan.title;
      view.directory = join(task.parent, plan.folder);
      view.files = plan.files;
      view.warning = plan.warning;
      task.directories = [plan.folder, ...plan.directories.map((path) => `${plan.folder}/${path}`)];
      task.prepared = true;
    }
    view.state = 'downloading';
    publish();
    await ensureDirectory(task.parent, [basename(view.directory)]);
    for (const directory of task.directories) {
      if (task.stop) return;
      try {
        await ensureDirectory(task.parent, directory.split('/'));
      } catch (error) {
        view.warning = [view.warning, message(error)].filter(Boolean).join('\n');
      }
    }
    for (const file of view.files) {
      if (task.stop) break;
      if (file.state !== 'queued') continue;
      file.state = 'downloading';
      publish();
      let temporary: string | undefined;
      try {
        const cached = await canvasExportFile(file.sourceId);
        const relative = file.path.split('/');
        const folder = await ensureDirectory(task.parent, [
          basename(view.directory),
          ...relative.slice(0, -1),
        ]);
        const destination = join(folder, relative.at(-1)!);
        try {
          const info = await lstat(destination);
          if (!info.isFile() || info.isSymbolicLink())
            throw new Error('目标位置不是普通文件，无法覆盖');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        temporary = join(dirname(destination), `.dela-${randomUUID()}.part`);
        await copyFile(cached.path, temporary, constants.COPYFILE_EXCL);
        await rename(temporary, destination);
        temporary = undefined;
        file.state = 'completed';
      } catch (error) {
        file.state = 'failed';
        file.error = message(error);
      } finally {
        if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
        publish();
      }
    }
    view.state = 'completed';
  } catch (error) {
    view.state = 'failed';
    view.error = message(error);
  } finally {
    if (task.stop) {
      view.state = 'cancelled';
      for (const file of view.files) if (file.state === 'queued') file.state = 'cancelled';
    }
    publish();
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = [...tasks.values()].find((task) => task.view.state === 'queued');
      if (!next) break;
      await run(next);
    }
  } finally {
    running = false;
  }
}

/** parent 只能来自主进程的原生目录选择器，renderer 不传入任意写入路径。 */
export function startCanvasDownload(
  selection: CanvasDownloadSelection,
  parent: string,
): CanvasDownload {
  const plan = canvasDownloadPlan(getCanvasState(), selection);
  const view: CanvasDownload = {
    id: randomUUID(),
    title: plan.title,
    directory: join(parent, plan.folder),
    state: 'queued',
    files: [],
  };
  tasks.set(view.id, { view, selection, parent, directories: [], prepared: false, stop: false });
  publish();
  void pump();
  return structuredClone(view);
}

function taskOf(id: string) {
  const task = tasks.get(id);
  if (!task) throw new Error('下载任务不存在');
  return task;
}

export function stopCanvasDownload(id: string) {
  const task = taskOf(id);
  if (!['queued', 'preparing', 'downloading'].includes(task.view.state)) return;
  task.stop = true;
  if (task.view.state === 'queued') {
    task.view.state = 'cancelled';
    for (const file of task.view.files) if (file.state === 'queued') file.state = 'cancelled';
  } else task.view.state = 'stopping';
  publish();
}

export function retryCanvasDownload(id: string, sourceId?: string) {
  const task = taskOf(id);
  if (['queued', 'preparing', 'downloading', 'stopping'].includes(task.view.state))
    throw new Error('请等待当前下载结束');
  const failed = task.view.files.filter(
    (file) => file.state === 'failed' && (!sourceId || file.sourceId === sourceId),
  );
  if (!failed.length && !(task.view.state === 'failed' && !sourceId))
    throw new Error('没有可重试的失败文件');
  for (const file of failed) {
    file.state = 'queued';
    delete file.error;
  }
  task.stop = false;
  delete task.view.error;
  task.view.state = 'queued';
  publish();
  void pump();
}

export async function revealCanvasDownload(id: string) {
  const error = await shell.openPath(taskOf(id).view.directory);
  if (error) throw new Error(error);
}
