import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type DownloadItem,
  type IpcMainInvokeEvent,
} from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { VideoDownload } from '../../shared/vsjtu';
import { checkWorkspaceSender } from '../ipc';
import {
  experimentEnabled,
  savedVideoDownloadDirectory,
  setVideoDownloadDirectory,
} from '../settings/prefs';
import { flushCampusSession, getCampusSession, openCampusLoginWindow } from '../campus';
import { loadCanvasToken } from '../credentials';
import {
  checkVideoLogin,
  getStreams,
  listCourses,
  listVideos,
  getTranscript,
  formatTranscript,
  loginWithCanvas,
  VIDEO_HOME,
} from './api';
import { safeFileName } from './transcript';
import { issuePlayback } from './playback';

const id = z.number().int().positive();
const downloads = new Map<string, { info: VideoDownload; item: DownloadItem; path: string }>();
const pending = new Set<string>();
// 观看是常规功能；只有下载属于试验功能（总开关与「课堂视频下载」子项都开启才可用）。
function downloadEnabled(): void {
  if (!experimentEnabled('videoDownload'))
    throw new Error('请先在设置 → 通用的试验功能中开启「课堂视频下载」');
}

/** 下载开关关闭时立即取消进行中的任务。 */
export function cancelVideoDownloads(): void {
  for (const download of downloads.values())
    if (download.info.state === 'progressing') download.item.cancel();
}
function notify(info: VideoDownload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    // 校园登录窗口不接收下载数据。
    const url = window.webContents.getURL();
    if (url.startsWith('file:') || url.startsWith('http://127.0.0.1:5173'))
      window.webContents.send('vsjtu:download-changed', info);
  }
}

async function downloadVideo(
  event: IpcMainInvokeEvent,
  videoId: number,
  view: number,
  suggestedName: string,
): Promise<void> {
  const key = `${videoId}/${view}`;
  if (pending.has(key) || downloads.get(key)?.info.state === 'progressing')
    throw new Error('该画面正在下载');
  pending.add(key);
  try {
    const name = `${safeFileName(suggestedName) || videoId}-画面${view}.mp4`;
    const parent = BrowserWindow.fromWebContents(event.sender);
    const directory = savedVideoDownloadDirectory();
    const options = {
      title: '下载课堂视频',
      defaultPath: directory ? join(directory, name) : name,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    };
    const selected = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return;
    downloadEnabled();
    const stream = (await getStreams(videoId)).find((stream) => stream.view === view);
    if (!stream) throw new Error('该画面暂不可用');
    const target = stream.url;
    const campus = await getCampusSession();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        campus.removeListener('will-download', listener);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('下载启动超时，请重试'));
      }, 20000);
      const listener = (_event: Electron.Event, item: DownloadItem) => {
        if (item.getURL() !== target) return;
        cleanup();
        item.setSavePath(selected.filePath!);
        const download = {
          info: {
            id: key,
            name,
            received: 0,
            total: item.getTotalBytes(),
            state: 'progressing' as VideoDownload['state'],
          },
          item,
          path: selected.filePath!,
        };
        downloads.set(key, download);
        const update = (state: VideoDownload['state']) => {
          download.info = {
            ...download.info,
            received: item.getReceivedBytes(),
            total: item.getTotalBytes(),
            state,
          };
          notify(download.info);
        };
        let interrupted = false;
        item.on('updated', (_event, state) => {
          update(state);
          // 首版不承诺跨链接续传，中断后由用户重新下载。
          if (state === 'interrupted') {
            interrupted = true;
            item.cancel();
          }
        });
        item.once('done', (_event, state) => update(interrupted ? 'interrupted' : state));
        notify(download.info);
        resolve();
      };
      campus.on('will-download', listener);
      try {
        campus.downloadURL(target);
      } catch {
        cleanup();
        reject(new Error('无法启动视频下载'));
      }
    });
  } finally {
    pending.delete(key);
  }
}

export function registerVsjtuIpc(): void {
  const check = (event: IpcMainInvokeEvent) => checkWorkspaceSender(event);
  const checkDownload = (event: IpcMainInvokeEvent) => {
    checkWorkspaceSender(event);
    downloadEnabled();
  };
  ipcMain.handle('vsjtu:connect', async (event) => {
    check(event);
    if (loadCanvasToken())
      try {
        await loginWithCanvas();
        await checkVideoLogin();
        return { ok: true as const };
      } catch {
        // Canvas 登录失败时回落到官方登录窗口，由用户手动登录。
      }
    return openCampusLoginWindow({
      sender: event.sender,
      title: '登录交大视频',
      url: VIDEO_HOME,
      reached: (url) => url.startsWith(VIDEO_HOME),
      retryProbe: true,
      probe: async () => {
        await checkVideoLogin();
        await flushCampusSession();
      },
    });
  });
  ipcMain.handle('vsjtu:list-courses', (event) => {
    check(event);
    return listCourses();
  });
  ipcMain.handle('vsjtu:list-videos', (event, courseId, source) => {
    check(event);
    return listVideos(id.parse(courseId), z.literal('canvas').optional().parse(source));
  });
  ipcMain.handle('vsjtu:streams', async (event, videoId) => {
    check(event);
    return issuePlayback(id.parse(videoId));
  });
  ipcMain.handle('vsjtu:transcript', (event, videoId) => {
    check(event);
    return getTranscript(id.parse(videoId));
  });
  ipcMain.handle('vsjtu:export-transcript', async (event, videoId, rawTitle) => {
    check(event);
    const title = z.string().trim().min(1).max(200).parse(rawTitle);
    const transcript = await getTranscript(id.parse(videoId));
    if (!transcript) throw new Error('该录像暂无语音文稿');
    const name = safeFileName(title);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '导出语音文稿',
      defaultPath: `${name}-${videoId}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    };
    const selected = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { saved: false };
    await writeFile(selected.filePath, formatTranscript(transcript, title), 'utf8');
    return { saved: true };
  });
  ipcMain.handle('vsjtu:download', (event, videoId, view, name) => {
    checkDownload(event);
    return downloadVideo(event, id.parse(videoId), id.parse(view), z.string().max(200).parse(name));
  });
  ipcMain.handle('vsjtu:downloads', (event) => {
    checkWorkspaceSender(event);
    return [...downloads.values()].map((download) => download.info);
  });
  ipcMain.handle('vsjtu:cancel-download', (event, key) => {
    checkWorkspaceSender(event);
    downloads.get(z.string().parse(key))?.item.cancel();
  });
  ipcMain.handle('vsjtu:reveal-download', (event, key) => {
    checkWorkspaceSender(event);
    const download = downloads.get(z.string().parse(key));
    if (download?.info.state === 'completed') shell.showItemInFolder(download.path);
  });
  ipcMain.handle('vsjtu:get-download-directory', (event) => {
    checkDownload(event);
    return savedVideoDownloadDirectory();
  });
  ipcMain.handle('vsjtu:choose-download-directory', async (event) => {
    checkDownload(event);
    const result = await dialog.showOpenDialog({
      title: '课堂录像的默认保存位置（每次下载仍可在保存对话框里改）',
      defaultPath: savedVideoDownloadDirectory() || app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory'],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return savedVideoDownloadDirectory();
    return setVideoDownloadDirectory(path);
  });
}
